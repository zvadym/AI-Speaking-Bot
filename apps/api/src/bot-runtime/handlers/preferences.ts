import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import {
  runBotUpdateEffect,
  type BotUpdateEffectResult
} from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { buildPersistentKeyboardState } from '../keyboard-state.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;
type PreferenceRoute = 'callback.level' | 'callback.reply' | 'reply_keyboard.voice_toggle';
type PreferenceResult = { level: string } | { replyMode: 'text' | 'voice' };

export interface PreferenceTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(
    callbackQueryId: string,
    text?: string,
    options?: { botKey?: string | null; showAlert?: boolean }
  ): Promise<unknown>;
  deleteTelegramMessage(
    chatId: number,
    messageId: number,
    options?: { botKey?: string | null }
  ): Promise<unknown>;
}

interface EffectRunner {
  <T extends Record<string, unknown>>(
    pool: Pool,
    input: {
      decisionId: string;
      stepKey: string;
      execute(client: PoolClient): Promise<T>;
    }
  ): Promise<BotUpdateEffectResult<T>>;
}

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '');
  return value.trim() ? value : fallback;
}

function buildPersistentReplyMarkup(keyboard: ReturnType<typeof buildPersistentKeyboardState>) {
  return {
    keyboard: [
      [{ text: keyboard.topicButtonText }, { text: keyboard.levelButtonText }],
      [{ text: keyboard.voiceButtonText }, { text: keyboard.progressButtonText || '· 📈 My progress' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function applyPreference(
  client: PoolClient,
  route: PreferenceRoute,
  update: PreparedUpdate
): Promise<PreferenceResult> {
  const chatId = update.input.chatId;
  if (chatId === null) throw new Error('missing_preference_chat_id');

  if (route === 'callback.level') {
    const level = String(update.routingFacts.callback?.value || '').trim().toLowerCase();
    if (!['a1', 'a2', 'b1', 'b2', 'c1'].includes(level)) {
      throw new BotRuntimeHandlerError('invalid_level_value', { retryable: false });
    }
    const changed = await client.query<{ level: string }>(
      `UPDATE user_bots
       SET level = $3,
           updated_at = NOW()
       WHERE chat_id = $1
         AND bot_key = $2
       RETURNING level`,
      [chatId, update.botKey, level]
    );
    if (!changed.rows[0]) throw new Error('preference_user_bot_missing');
    return { level: String(changed.rows[0].level || level).toLowerCase() };
  }

  if (route === 'callback.reply') {
    const value = String(update.routingFacts.callback?.value || '').trim().toLowerCase();
    if (value !== 'text' && value !== 'voice') {
      throw new BotRuntimeHandlerError('invalid_reply_mode', { retryable: false });
    }
    const changed = await client.query<{ reply_mode: string }>(
      `UPDATE user_bots
       SET reply_mode = $3,
           updated_at = NOW()
       WHERE chat_id = $1
         AND bot_key = $2
       RETURNING reply_mode`,
      [chatId, update.botKey, value]
    );
    if (!changed.rows[0]) throw new Error('preference_user_bot_missing');
    return { replyMode: value };
  }

  const current = await client.query<{ reply_mode: string }>(
    `SELECT reply_mode
     FROM user_bots
     WHERE chat_id = $1
       AND bot_key = $2
     FOR UPDATE`,
    [chatId, update.botKey]
  );
  if (!current.rows[0]) throw new Error('preference_user_bot_missing');
  const replyMode = String(current.rows[0].reply_mode || 'voice').toLowerCase() === 'voice'
    ? 'text'
    : 'voice';
  await client.query(
    `UPDATE user_bots
     SET reply_mode = $3,
         updated_at = NOW()
     WHERE chat_id = $1
       AND bot_key = $2`,
    [chatId, update.botKey, replyMode]
  );
  return { replyMode };
}

export function createPreferenceHandlers({
  pool,
  getBotLocale,
  telegramClient,
  effectRunner = runBotUpdateEffect,
  keyboardStateLoader = fetchKeyboardState,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: PreferenceTelegramClient;
  effectRunner?: EffectRunner;
  keyboardStateLoader?: typeof fetchKeyboardState;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler[] {
  const routes: PreferenceRoute[] = [
    'callback.level',
    'callback.reply',
    'reply_keyboard.voice_toggle'
  ];

  return routes.map((route): BotHandler => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate & { route: typeof route }) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_preference_chat_id', { retryable: false });
      }

      let effect: BotUpdateEffectResult<PreferenceResult>;
      try {
        effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: `${route}:state:v1`,
          execute: (client) => applyPreference(client, route, update)
        });
      } catch (error) {
        if (error instanceof BotRuntimeHandlerError) throw error;
        throw new BotRuntimeHandlerError('preference_state_unavailable', {
          retryable: true,
          cause: error
        });
      }

      const locale = localeRecord(getBotLocale(update.botKey));
      const callback = update.input.callbackQuery;
      if (callback) {
        await Promise.allSettled([
          telegramClient.answerTelegramCallbackQuery(
            callback.id,
            localeText(locale, 'callback_saved', 'Saved ✅'),
            { botKey: update.botKey }
          ),
          callback.messageId
            ? telegramClient.deleteTelegramMessage(chatId, callback.messageId, {
              botKey: update.botKey
            })
            : Promise.resolve()
        ]);
      }

      let keyboard;
      try {
        const row = await keyboardStateLoader(pool, chatId, update.botKey);
        keyboard = buildPersistentKeyboardState(row, locale, update.input);
      } catch (error) {
        throw new BotRuntimeHandlerError('preference_context_unavailable', {
          retryable: true,
          cause: error
        });
      }

      const text = 'level' in effect.result
        ? localeText(locale, 'level_saved_prefix', 'Level saved: ') +
          effect.result.level.toUpperCase()
        : localeText(locale, 'reply_mode_saved_prefix', 'Reply mode: ') +
          (effect.result.replyMode === 'voice'
            ? localeText(locale, 'reply_mode_voice', 'voice')
            : localeText(locale, 'reply_mode_text', 'text'));

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: `${route}:confirmation:v1`,
        text,
        replyMarkup: buildPersistentReplyMarkup(keyboard)
      });
    }
  }));
}
