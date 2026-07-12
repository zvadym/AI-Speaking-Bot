import type { Pool, PoolClient } from 'pg';
import { escapeTelegramHtmlText } from '../../shared/telegram-delivery.js';
import type {
  BotAiClient,
  FollowUpHints,
  VocabularyItem
} from '../bot-ai.js';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  classifyTelegramDeliveryError,
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;
type SupportRoute =
  | 'callback.transcript_translate'
  | 'callback.translate'
  | 'callback.hints'
  | 'callback.vocab';

export interface SupportTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(
    callbackQueryId: string,
    text?: string,
    options?: { botKey?: string | null; showAlert?: boolean }
  ): Promise<unknown>;
  editTelegramMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: {
      botKey?: string | null;
      parseMode?: 'HTML' | null;
      replyMarkup?: object | null;
    }
  ): Promise<unknown>;
}

interface AssistantContext extends Record<string, unknown> {
  content: string;
  translation_base: string;
  follow_up_hints: string;
  user_content: string;
  level: string;
  topic_pack_json: unknown;
  topic_enabled: boolean;
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

function messageId(update: PreparedUpdate): number {
  const value = Number(update.routingFacts.callback?.value);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BotRuntimeHandlerError('invalid_callback_message_id', { retryable: false });
  }
  return value;
}

function tierBits(raw: unknown): string {
  const value = String(raw || '');
  if (/^[01]{3}$/.test(value)) return value;
  if (/^[01]{2}$/.test(value)) return `${value}0`;
  return '000';
}

function supportMarkup(id: number, rawTier: unknown, used: 0 | 1 | 2, locale: Locale) {
  const bits = tierBits(rawTier).split('');
  bits[used] = '1';
  const next = bits.join('');
  return {
    inline_keyboard: [
      [
        {
          text: localeText(locale, 'btn_translation', 'Translation'),
          callback_data: bits[0] === '1' ? 'busy:1' : `tr:${id}:${next}`
        },
        {
          text: localeText(locale, 'btn_vocab', 'Vocabulary'),
          callback_data: bits[2] === '1' ? 'busy:1' : `voc:${id}:${next}`
        }
      ],
      [{
        text: localeText(locale, 'btn_follow_up_hints', 'Reply ideas'),
        callback_data: bits[1] === '1' ? 'busy:1' : `hint:${id}:${next}`
      }]
    ]
  };
}

function parseHints(raw: unknown): FollowUpHints | null {
  let value = raw;
  if (typeof value === 'string' && value.trim()) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as FollowUpHints
    : null;
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

async function fetchAssistant(
  client: PoolClient | Pool,
  update: PreparedUpdate,
  id: number
): Promise<AssistantContext> {
  const result = await client.query<AssistantContext>(
    `SELECT
       m.content,
       m.translation_base,
       m.follow_up_hints,
       COALESCE(prev.content, '') AS user_content,
       ub.level,
       ub.topic_pack_json,
       ub.topic_enabled
     FROM messages m
     JOIN user_bots ub
       ON ub.chat_id = m.chat_id AND ub.bot_key = m.bot_key
     LEFT JOIN LATERAL (
       SELECT content
       FROM messages p
       WHERE p.chat_id = m.chat_id
         AND p.bot_key = m.bot_key
         AND p.role = 'user'
         AND p.id < m.id
       ORDER BY p.id DESC
       LIMIT 1
     ) prev ON true
     WHERE m.chat_id = $1
       AND m.bot_key = $2
       AND m.role = 'assistant'
       AND m.id = $3
     LIMIT 1`,
    [update.input.chatId, update.botKey, id]
  );
  if (!result.rows[0]) {
    throw new BotRuntimeHandlerError('assistant_message_not_found', { retryable: false });
  }
  return result.rows[0];
}

function formatHints(hints: FollowUpHints, locale: Locale): string {
  const esc = escapeTelegramHtmlText;
  const blocks = [`<b>${esc(localeText(locale, 'hints_intro', 'Reply ideas'))}</b>`];
  const pair = (title: string, text: unknown, base: unknown) => {
    const first = String(text || '').trim();
    const second = String(base || '').trim();
    if (!first && !second) return;
    const lines = [first ? `<code>${esc(first)}</code>` : '', second ? esc(second) : '']
      .filter(Boolean)
      .join('\n');
    blocks.push(`<b>${esc(title)}</b>\n<blockquote>${lines}</blockquote>`);
  };
  pair(localeText(locale, 'hints_section_question', 'Question:'), hints.question, hints.question_base);
  pair(localeText(locale, 'hints_section_simple', 'Simple:'), hints.simple_variant, hints.simple_variant_base);
  pair(
    localeText(locale, 'hints_section_conversational', 'Conversational:'),
    hints.conversational_variant,
    hints.conversational_variant_base
  );
  pair(localeText(locale, 'hints_section_advanced', 'Advanced:'), hints.advanced_variant, hints.advanced_variant_base);
  const phrases = Array.isArray(hints.useful_phrases) ? hints.useful_phrases : [];
  if (phrases.length) {
    blocks.push(
      `<b>${esc(localeText(locale, 'hints_section_phrases', 'Useful phrases:'))}</b>\n<blockquote>${phrases
        .slice(0, 4)
        .map((item) => `• <code>${esc(item.text)}</code>${item.translation_base ? ` — ${esc(item.translation_base)}` : ''}`)
        .join('\n')}</blockquote>`
    );
  }
  return blocks.join('\n\n').slice(0, 3900);
}

function formatVocabulary(items: VocabularyItem[]): string {
  if (!items.length) return 'No vocabulary items found.';
  return items.slice(0, 15).map((item) => {
    const display = item.pos === 'noun'
      ? [item.article, item.lemma || item.surface].filter(Boolean).join(' ')
      : item.pos === 'verb'
        ? item.infinitive || item.lemma || item.surface
        : item.lemma || item.surface;
    const ipa = item.transcription ? ` [${escapeTelegramHtmlText(item.transcription)}]` : '';
    return `• <b>${escapeTelegramHtmlText(display)}</b>${ipa} — ${escapeTelegramHtmlText(item.translation_base)}`;
  }).join('\n').slice(0, 3900);
}

function translatedMessage(base: string, translation: string, locale: Locale): string {
  const header = localeText(locale, 'translation_header', 'Translation:');
  const marker = `\n\n${header}\n`;
  const markerIndex = base.indexOf(marker);
  const original = (markerIndex >= 0 ? base.slice(0, markerIndex) : base).trimEnd();
  const fallback = localeText(locale, 'translation_fallback_missing', 'Translation is unavailable.');
  return `${original}\n\n${header}\n${translation || fallback}`.slice(0, 3900);
}

async function editMessage(
  telegramClient: SupportTelegramClient,
  update: PreparedUpdate,
  text: string,
  replyMarkup: object | null
): Promise<void> {
  const messageId = update.input.callbackQuery?.messageId;
  const chatId = update.input.chatId;
  if (!messageId || !chatId) {
    throw new BotRuntimeHandlerError('callback_message_missing', { retryable: false });
  }
  try {
    await telegramClient.editTelegramMessageText(chatId, messageId, text, {
      botKey: update.botKey,
      replyMarkup
    });
  } catch (error) {
    const classified = classifyTelegramDeliveryError(error);
    throw new BotRuntimeHandlerError(classified.errorCode, {
      retryable: classified.kind === 'retryable',
      cause: error
    });
  }
}

export function createSupportCallbackHandlers({
  pool,
  getBotLocale,
  telegramClient,
  ai,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: SupportTelegramClient;
  ai: BotAiClient;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler[] {
  const routes: SupportRoute[] = [
    'callback.transcript_translate',
    'callback.translate',
    'callback.hints',
    'callback.vocab'
  ];

  return routes.map((route): BotHandler => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate & { route: typeof route }) {
      const callback = update.input.callbackQuery;
      const chatId = update.input.chatId;
      if (!callback || chatId === null) {
        throw new BotRuntimeHandlerError('invalid_support_callback', { retryable: false });
      }
      const locale = localeRecord(getBotLocale(update.botKey));
      try {
        await telegramClient.answerTelegramCallbackQuery(
          callback.id,
          localeText(locale, 'callback_translating', 'Preparing...'),
          { botKey: update.botKey }
        );
      } catch {
        // Ephemeral acknowledgement does not control durable processing.
      }

      if (route === 'callback.transcript_translate') {
        const raw = callback.messageText;
        const prefix = localeText(locale, 'user_text_prefix_multiline', '');
        const transcript = (prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw).trim();
        if (!transcript) throw new BotRuntimeHandlerError('transcript_missing', { retryable: false });
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'callback.transcript_translate:ai:v1',
          execute: async () => ({
            translation: await ai.translate(update.botKey, transcript, {
              decisionId: update.decisionId,
              chatId,
              botKey: update.botKey,
              route: update.route
            })
          })
        });
        await editMessage(
          telegramClient,
          update,
          translatedMessage(raw, String(effect.result.translation || ''), locale),
          { inline_keyboard: [[{
            text: localeText(locale, 'btn_translation', 'Translation'),
            callback_data: 'busy:1'
          }]] }
        );
        return { status: 'noop' };
      }

      const id = messageId(update);
      if (route === 'callback.translate') {
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'callback.translate:state:v1',
          execute: async (client) => {
            const row = await fetchAssistant(client, update, id);
            const cached = String(row.translation_base || '').trim();
            const translation = cached || await ai.translate(update.botKey, row.content, {
              decisionId: update.decisionId,
              chatId,
              botKey: update.botKey,
              route: update.route
            });
            if (!cached) {
              await client.query(
                `UPDATE messages SET translation_base = $1
                  WHERE id = $2 AND chat_id = $3 AND bot_key = $4 AND role = 'assistant'`,
                [translation, id, update.input.chatId, update.botKey]
              );
            }
            return { translation };
          }
        });
        await editMessage(
          telegramClient,
          update,
          translatedMessage(callback.messageText, String(effect.result.translation || ''), locale),
          supportMarkup(id, update.routingFacts.callback?.tier, 0, locale)
        );
        return { status: 'noop' };
      }

      if (route === 'callback.hints') {
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'callback.hints:state:v1',
          execute: async (client) => {
            const row = await fetchAssistant(client, update, id);
            const cached = parseHints(row.follow_up_hints);
            const hints = cached || await ai.hints({
              botKey: update.botKey,
              level: String(row.level || 'a1'),
              userMessage: String(row.user_content || ''),
              assistantReply: String(row.content || ''),
              topic: topicValue(row.topic_pack_json, row.topic_enabled),
              trace: {
                decisionId: update.decisionId,
                chatId,
                botKey: update.botKey,
                route: update.route
              }
            });
            if (!cached) {
              await client.query(
                `UPDATE messages SET follow_up_hints = $1
                  WHERE id = $2 AND chat_id = $3 AND bot_key = $4 AND role = 'assistant'`,
                [JSON.stringify(hints), id, update.input.chatId, update.botKey]
              );
            }
            return { hints };
          }
        });
        const outcome = await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.hints:message:v1',
          text: formatHints(effect.result.hints as FollowUpHints, locale),
          parseMode: 'HTML'
        });
        await editMessage(
          telegramClient,
          update,
          callback.messageText,
          supportMarkup(id, update.routingFacts.callback?.tier, 1, locale)
        );
        return outcome;
      }

      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'callback.vocab:ai:v1',
        execute: async (client) => {
          const row = await fetchAssistant(client, update, id);
          return {
            items: await ai.vocabulary(update.botKey, String(row.content || ''), {
              decisionId: update.decisionId,
              chatId,
              botKey: update.botKey,
              route: update.route
            })
          };
        }
      });
      const outcome = await textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'callback.vocab:message:v1',
        text: formatVocabulary(effect.result.items as VocabularyItem[]),
        parseMode: 'HTML'
      });
      await editMessage(
        telegramClient,
        update,
        callback.messageText,
        supportMarkup(id, update.routingFacts.callback?.tier, 2, locale)
      );
      return outcome;
    }
  }));
}
