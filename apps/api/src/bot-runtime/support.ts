import type { Pool, PoolClient } from 'pg';
import { escapeTelegramHtmlText } from '../shared/telegram-delivery.js';
import type { FollowUpHints, VocabularyItem } from '../ai/client.js';
import type { VocabularySnapshotRow } from '../vocabulary/snapshots.js';
import type { PreparedUpdate } from './contracts.js';
import { BotRuntimeHandlerError } from './handler-registry.js';
import type { MessagePresentationService } from './delivery/message-presentation.js';
import {
  classifyTelegramDeliveryError,
  type TelegramTextClient
} from './delivery/telegram-text-delivery.js';

export type Locale = Record<string, unknown>;
export type SupportRoute =
  | 'callback.transcript_translate'
  | 'callback.translate'
  | 'callback.hints'
  | 'callback.vocab';

export interface SupportTelegramClient extends TelegramTextClient {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>): Promise<unknown>;
  editTelegramMessageReplyMarkup?(
    chatId: number, messageId: number, replyMarkup: object,
    options: { botKey: string }
  ): Promise<unknown>;
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
}

export function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

export function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '').trim();
  return value || fallback;
}

export function messageId(update: PreparedUpdate): number {
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

export function supportMarkup(id: number, rawTier: unknown, used: 0 | 1 | 2, locale: Locale) {
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

export function parseHints(raw: unknown): FollowUpHints | null {
  let value = raw;
  if (typeof value === 'string' && value.trim()) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as FollowUpHints
    : null;
}

export async function fetchAssistant(
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
       ub.level
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

export function formatHints(hints: FollowUpHints, locale: Locale): string {
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

export function formatVocabulary(items: VocabularyItem[], locale: Locale, rows?:VocabularySnapshotRow[]) {
  if (!items.length) return {blocks: [{type: 'paragraph', text: localeText(locale, 'vocab_empty', 'No vocabulary items found.')} ]};
  const headers = [
    localeText(locale, 'vocab_column_original', 'Original'),
    localeText(locale, 'vocab_column_translation', 'Translation'),
    localeText(locale, 'vocab_column_transcription', 'Transcription')
  ];
  if(rows)headers.push(localeText(locale,'vocab_column_dictionary','My vocabulary'));
  const cells = [headers.map(text => ({text, is_header: true, align: 'left', valign: 'top'})),
    ...items.slice(0, 15).map((item,index) => {
      const display = item.pos === 'noun'
        ? [item.article, item.lemma || item.surface].filter(Boolean).join(' ')
        : item.pos === 'verb'
          ? item.infinitive || item.lemma || item.surface
          : item.lemma || item.surface;
      const cells:Array<{text:unknown;align:string;valign:string}>=[display, item.translation_base, item.transcription ? `[${item.transcription}]` : '—']
        .map(text => ({text, align: 'left', valign: 'top'}));
      if(rows){
        const row=rows[index];
        const label=row.progress===null ? localeText(locale,'vocab_add','Add')
          : row.progress>=5 ? `✓ ${localeText(locale,'vocab_learned','Learned')}` : `✓ ${row.progress}/5`;
        cells.push({text:{type:'button',button:{text:label,callback_data:`vadd:${row.id}`}},align:'left',valign:'top'});
      }
      return cells;
    })];
  // Structured plain-text cells preserve IPA and literal markup without HTML parsing.
  return {blocks: [{type: 'table', is_compact: true, is_striped: true, cells}]};
}

export function translatedMessage(base: string, translation: string, locale: Locale): string {
  const header = localeText(locale, 'translation_header', 'Translation:');
  const marker = `\n\n${header}\n`;
  const markerIndex = base.indexOf(marker);
  const original = (markerIndex >= 0 ? base.slice(0, markerIndex) : base).trimEnd();
  const fallback = localeText(locale, 'translation_fallback_missing', 'Translation is unavailable.');
  return `${original}\n\n${header}\n${translation || fallback}`.slice(0, 3900);
}

export async function editMessage(
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

export async function mutateSupportPresentation(
  presentation: MessagePresentationService | undefined, update: PreparedUpdate,
  id: number, locale: Locale, usedAction: 'tr' | 'hint' | 'voc', translation?: string
) {
  const callback = update.input.callbackQuery!;
  const chatId = update.input.chatId!;
  if (!callback.messageId) throw new BotRuntimeHandlerError('callback_message_missing', { retryable: false });
  if (!presentation) return false;
  const key = {
    messageId: id, telegramMessageId: callback.messageId, chatId, botKey: update.botKey
  };
  // Covers a callback racing the initial send's state write, and historical
  // messages. Existing state always wins over the callback's stale snapshot.
  await presentation.initialize(key, '', supportMarkup(id, update.routingFacts.callback?.tier,
    usedAction === 'tr' ? 0 : usedAction === 'hint' ? 1 : 2, locale));
  return presentation.mutate(key, {
    usedAction,
    ...(translation === undefined ? {} : { translation: {
      text: translation || localeText(locale, 'translation_fallback_missing', 'Translation is unavailable.'),
      header: localeText(locale, 'translation_header', 'Translation:')
    } })
  });
}

export async function markSupportUsed(
  presentation: MessagePresentationService | undefined, telegramClient: SupportTelegramClient,
  update: PreparedUpdate, id: number, locale: Locale, action: 'hint' | 'voc', bit: 1 | 2
) {
  const callback = update.input.callbackQuery!;
  const chatId = update.input.chatId!;
  if (await mutateSupportPresentation(presentation, update, id, locale, action)) return;
  // Historical messages also only need a keyboard edit; never replace their media.
  if (!telegramClient.editTelegramMessageReplyMarkup) throw new Error('telegram_markup_editor_missing');
  try {
    await telegramClient.editTelegramMessageReplyMarkup(chatId, callback.messageId!,
      supportMarkup(id, update.routingFacts.callback?.tier, bit, locale), { botKey: update.botKey });
  } catch (error) {
    if (!String((error as Error)?.message).toLowerCase().includes('message is not modified')) throw error;
  }
}
