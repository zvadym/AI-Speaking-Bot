import type { Pool, PoolClient } from 'pg';
import { sanitizeTelegramHtml } from '../../shared/telegram-delivery.js';
import type { BotAiClient, ConversationAiResult } from '../bot-ai.js';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;

export interface ConversationTelegramClient extends TelegramTextClient {
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>
  ): Promise<unknown>;
}

interface ConversationContext extends Record<string, unknown> {
  level: string;
  reply_mode: string;
  profile_summary: string;
  short_summary: string;
  topic_enabled: boolean;
  topic_template_id: string | null;
  topic_pack_json: unknown;
}

interface ConversationEffectResult extends Record<string, unknown> {
  assistantMessageId: number | null;
  response: ConversationAiResult;
}

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '').trim();
  return value || fallback;
}

function topicValue(raw: unknown, enabled: unknown): Record<string, unknown> | null {
  if (!enabled) return null;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

async function executeConversation(
  client: PoolClient,
  update: PreparedUpdate,
  ai: BotAiClient,
  text: string
): Promise<ConversationEffectResult> {
  const chatId = update.input.chatId as number;
  const contextResult = await client.query<ConversationContext>(
    `SELECT
       ub.level,
       ub.reply_mode,
       ub.topic_enabled,
       ub.topic_template_id,
       ub.topic_pack_json,
       COALESCE(s.profile_summary, '') AS profile_summary,
       COALESCE(s.short_summary, '') AS short_summary
     FROM user_bots ub
     LEFT JOIN user_summaries s
       ON s.chat_id = ub.chat_id AND s.bot_key = ub.bot_key
     WHERE ub.chat_id = $1 AND ub.bot_key = $2
     LIMIT 1`,
    [chatId, update.botKey]
  );
  const context = contextResult.rows[0];
  if (!context) throw new Error('conversation_user_bot_missing');
  const historyResult = await client.query<{ role: string; content: string }>(
    `SELECT role, content
       FROM (
         SELECT id, role, content
           FROM messages
          WHERE chat_id = $1
            AND bot_key = $2
            AND (($3::boolean AND topic_template_id = $4) OR (NOT $3::boolean AND topic_template_id IS NULL))
          ORDER BY id DESC
          LIMIT 20
       ) recent
      ORDER BY id`,
    [chatId, update.botKey, Boolean(context.topic_enabled), context.topic_template_id]
  );
  const topic = topicValue(context.topic_pack_json, context.topic_enabled);
  const response = await ai.respond({
    botKey: update.botKey,
    level: String(context.level || 'a1'),
    inputMode: 'text',
    text,
    profileSummary: String(context.profile_summary || ''),
    shortSummary: String(context.short_summary || ''),
    history: historyResult.rows,
    topic
  });
  if (!String(response.explanation_html || '').trim()) {
    throw new Error('conversation_explanation_missing');
  }

  await client.query(
    `INSERT INTO messages (chat_id, role, content, bot_key, topic_template_id)
     VALUES ($1, 'user', $2, $3, $4)`,
    [
      chatId,
      text,
      update.botKey,
      context.topic_enabled ? context.topic_template_id : null
    ]
  );

  let assistantMessageId: number | null = null;
  const reply = String(response.reply_text || '').trim();
  if (response.is_target_language && reply) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages (
         chat_id, role, content, translation_base, follow_up_hints, bot_key, topic_template_id
       ) VALUES ($1, 'assistant', $2, '', '[]', $3, $4)
       RETURNING id::text`,
      [
        chatId,
        reply,
        update.botKey,
        context.topic_enabled ? context.topic_template_id : null
      ]
    );
    assistantMessageId = Number(inserted.rows[0]?.id) || null;
  }
  return { assistantMessageId, response };
}

function replyMarkup(messageId: number, locale: Locale) {
  return {
    inline_keyboard: [
      [
        {
          text: localeText(locale, 'btn_translation', 'Translation'),
          callback_data: `tr:${messageId}:000`
        },
        {
          text: localeText(locale, 'btn_vocab', 'Vocabulary'),
          callback_data: `voc:${messageId}:000`
        }
      ],
      [{
        text: localeText(locale, 'btn_follow_up_hints', 'Reply ideas'),
        callback_data: `hint:${messageId}:000`
      }]
    ]
  };
}

export function createTextConversationHandler({
  pool,
  getBotLocale,
  telegramClient,
  ai,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: ConversationTelegramClient;
  ai: BotAiClient;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'message.text'> {
  return {
    route: 'message.text',
    version: BOT_RUNTIME_HANDLER_VERSIONS['message.text'],
    async execute(update: PreparedUpdate & { route: 'message.text' }) {
      const chatId = update.input.chatId;
      const text = String(update.input.message.text || '').trim();
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !text) {
        throw new BotRuntimeHandlerError('invalid_text_message', { retryable: false });
      }
      await Promise.allSettled([
        telegramClient.callTelegramApi(update.botKey, 'sendChatAction', {
          chat_id: chatId,
          action: 'typing'
        })
      ]);

      let result: ConversationEffectResult;
      try {
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'message.text:conversation:v1',
          execute: (client) => executeConversation(client, update, ai, text)
        });
        result = effect.result;
      } catch (error) {
        if (error instanceof BotRuntimeHandlerError) throw error;
        throw new BotRuntimeHandlerError('conversation_failed', {
          retryable: true,
          cause: error
        });
      }

      const locale = localeRecord(getBotLocale(update.botKey));
      const explanation = sanitizeTelegramHtml(result.response.explanation_html);
      if (!result.response.is_target_language) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.text:language-mismatch:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }

      if (result.response.has_mistakes && explanation) {
        await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.text:correction:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }
      const reply = String(result.response.reply_text || '').trim();
      if (!reply || !result.assistantMessageId) {
        throw new BotRuntimeHandlerError('conversation_reply_missing', { retryable: false });
      }
      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'message.text:reply:v1',
        text: reply,
        replyMarkup: replyMarkup(result.assistantMessageId, locale)
      });
    }
  };
}
