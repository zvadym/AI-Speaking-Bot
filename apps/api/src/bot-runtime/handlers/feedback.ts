import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type FeedbackRoute = 'command.feedback' | 'pending_feedback.text';
type Locale = Record<string, unknown>;

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '');
  return value.trim() ? value : fallback;
}

function feedbackText(update: PreparedUpdate, route: FeedbackRoute): string {
  return String(
    route === 'command.feedback'
      ? update.routingFacts.command?.args || ''
      : update.input.message.text || ''
  ).trim();
}

async function persistFeedback(
  client: PoolClient,
  update: PreparedUpdate,
  text: string
): Promise<{ outcome: 'saved' | 'prompt' }> {
  const chatId = update.input.chatId;
  if (chatId === null) throw new Error('missing_feedback_chat_id');

  if (!text) {
    await client.query(
      `INSERT INTO pending_feedback (chat_id, bot_key, expires_at, created_at)
       VALUES ($1, $2, NOW() + interval '10 minutes', NOW())
       ON CONFLICT (chat_id, bot_key)
       DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [chatId, update.botKey]
    );
    return { outcome: 'prompt' };
  }

  await client.query(
    `INSERT INTO feedback (
       chat_id,
       username,
       first_name,
       message_id,
       kind,
       feedback_text,
       transcript,
       telegram_file_id,
       bot_key
     )
     VALUES ($1, $2, $3, $4, 'text', $5, NULL, NULL, $6)`,
    [
      chatId,
      update.input.sender.username,
      update.input.sender.firstName,
      update.input.message.id,
      text,
      update.botKey
    ]
  );
  await client.query(
    `DELETE FROM pending_feedback
     WHERE chat_id = $1
       AND bot_key = $2`,
    [chatId, update.botKey]
  );
  return { outcome: 'saved' };
}

export function createFeedbackHandlers({
  pool,
  getBotLocale,
  telegramClient,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler[] {
  const routes: FeedbackRoute[] = ['command.feedback', 'pending_feedback.text'];

  return routes.map((route): BotHandler => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate & { route: typeof route }) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_feedback_chat_id', { retryable: false });
      }
      const text = feedbackText(update, route);

      let outcome: 'saved' | 'prompt';
      try {
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: `${route}:state:v1`,
          execute: (client) => persistFeedback(client, update, text)
        });
        outcome = effect.result.outcome;
      } catch (error) {
        throw new BotRuntimeHandlerError('feedback_state_unavailable', {
          retryable: true,
          cause: error
        });
      }

      const locale = localeRecord(getBotLocale(update.botKey));
      const message = outcome === 'saved'
        ? localeText(locale, 'msg_feedback_thanks', 'Thanks, I received your feedback.')
        : localeText(
          locale,
          'msg_feedback_prompt',
          'Please send feedback as text or a voice message.'
        );

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: `${route}:${outcome}:v1`,
        text: message
      });
    }
  }));
}
