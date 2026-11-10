import type { Pool } from 'pg';
import { BotRuntimeHandlerError } from './handler-registry.js';
import { classifyTelegramDeliveryError } from './telegram-text-delivery.js';

type Markup = { inline_keyboard: Array<Array<Record<string, unknown>>> };
export interface PresentationState {
  text: string;
  replyMarkup: Markup;
  translation?: { text: string; header: string };
  voiceFileId?: string;
  voiceAttached?: boolean;
}
export interface PresentationKey {
  messageId: number;
  telegramMessageId: number;
  chatId: number;
  botKey: string;
}
export interface PresentationClient {
  editTelegramMessageRich(chatId: number, messageId: number, richMessage: object,
    options: { botKey: string; replyMarkup: object; audio?: Buffer; signal?: AbortSignal }): Promise<unknown>;
  editTelegramMessageText(chatId: number, messageId: number, text: string,
    options: { botKey: string; replyMarkup: object; signal?: AbortSignal }): Promise<unknown>;
  editTelegramMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: object,
    options: { botKey: string; signal?: AbortSignal }): Promise<unknown>;
}
export interface PresentationMutation {
  translation?: { text: string; header: string };
  usedAction?: 'tr' | 'hint' | 'voc';
  audio?: Buffer;
  ensureVoice?: boolean;
}
export interface MessagePresentationService {
  initialize(key: PresentationKey, text: string, replyMarkup: object): Promise<void>;
  hasVoice(key: PresentationKey): Promise<boolean>;
  mutate(key: PresentationKey, mutation: PresentationMutation): Promise<boolean>;
}

export function markPresentationActionUsed(markup: Markup, action: string): Markup {
  return { inline_keyboard: markup.inline_keyboard.map((row) => row.map((button) => {
    const group = String(button.callback_data || '').split(':')[0];
    return group === action ? { ...button, callback_data: 'busy:1' } : { ...button };
  })) };
}

export function presentationText(state: PresentationState): string {
  return state.translation
    ? `${state.text}\n\n${state.translation.header}\n${state.translation.text}`
    : state.text;
}

export function presentationRichMessage(state: PresentationState, hasPendingAudio: boolean): object {
  return { blocks: [
    { type: 'paragraph', text: presentationText(state) },
    { type: 'voice_note', voice_note: {
      type: 'voice_note', media: state.voiceFileId || (hasPendingAudio ? 'attach://voice' : '')
    } }
  ] };
}

function voiceFileId(result: unknown): string | undefined {
  const message = result as { rich_message?: { blocks?: Array<{ type?: string; voice_note?: { file_id?: string } }> } };
  return message?.rich_message?.blocks?.find((block) => block.type === 'voice_note')?.voice_note?.file_id;
}

export function createMessagePresentationService(pool: Pool, telegram: PresentationClient): MessagePresentationService {
  return {
    async initialize(key, text, replyMarkup) {
      const result = await pool.query(
        `INSERT INTO bot_message_presentations (message_id, telegram_message_id, state)
         SELECT id, $4, jsonb_set($5::jsonb, '{text}',
           to_jsonb(COALESCE(NULLIF($5::jsonb->>'text', ''), content))) FROM messages
         WHERE id = $1 AND chat_id = $2 AND bot_key = $3 AND role = 'assistant'
         ON CONFLICT (message_id) DO NOTHING`,
        [key.messageId, key.chatId, key.botKey, key.telegramMessageId, JSON.stringify({ text, replyMarkup })]
      );
      if (result.rowCount !== 1) {
        const existing = await pool.query(
          `SELECT p.message_id FROM bot_message_presentations p JOIN messages m ON m.id = p.message_id
           WHERE m.id = $1 AND m.chat_id = $2 AND m.bot_key = $3 AND p.telegram_message_id = $4`,
          [key.messageId, key.chatId, key.botKey, key.telegramMessageId]
        );
        if (!existing.rowCount) throw new Error('presentation_message_mismatch');
      }
    },
    async hasVoice(key) {
      const result = await pool.query(
        `SELECT (p.pending_audio IS NOT NULL OR p.state->>'voiceFileId' IS NOT NULL) AS ready
         FROM bot_message_presentations p JOIN messages m ON m.id = p.message_id
         WHERE m.id = $1 AND m.chat_id = $2 AND m.bot_key = $3 AND p.telegram_message_id = $4`,
        [key.messageId, key.chatId, key.botKey, key.telegramMessageId]
      );
      return result.rows[0]?.ready === true;
    },
    async mutate(key, mutation) {
      const client = await pool.connect();
      const lock = `telegram-presentation:${key.messageId}`;
      let locked = false;
      let releaseError: Error | undefined;
      try {
        // Session lock: desired state is committed before Telegram, so an ambiguous
        // edit can be replayed without downgrading an already uploaded voice note.
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lock]);
        locked = true;
        const result = await client.query<{ state: PresentationState; pending_audio: Buffer | null; content_dirty: boolean }>(
          `SELECT p.state, p.pending_audio, p.content_dirty FROM bot_message_presentations p
           JOIN messages m ON m.id = p.message_id
           WHERE m.id = $1 AND m.chat_id = $2 AND m.bot_key = $3 AND p.telegram_message_id = $4`,
          [key.messageId, key.chatId, key.botKey, key.telegramMessageId]
        );
        const row = result.rows[0];
        if (!row) return false; // Historical plain-text message.
        const state = row.state;
        let audio = row.pending_audio;
        let dirty = row.content_dirty;
        if (mutation.translation) { state.translation = mutation.translation; dirty = true; }
        if (mutation.usedAction) state.replyMarkup = markPresentationActionUsed(state.replyMarkup, mutation.usedAction);
        if (mutation.audio && !state.voiceFileId && !audio) { audio = mutation.audio; dirty = true; }
        if (mutation.ensureVoice && !state.voiceFileId && !audio) throw new Error('presentation_audio_missing');
        if (mutation.ensureVoice && state.voiceAttached && !dirty && !mutation.usedAction && !mutation.translation) return true;
        await client.query(
          `UPDATE bot_message_presentations SET state = $2::jsonb, pending_audio = $3,
           content_dirty = $4, updated_at = now() WHERE message_id = $1`,
          [key.messageId, JSON.stringify(state), audio, dirty]
        );
        const options = { botKey: key.botKey, replyMarkup: state.replyMarkup, signal: AbortSignal.timeout(10000) };
        let edited: unknown;
        try {
          if (!dirty) {
            edited = await telegram.editTelegramMessageReplyMarkup(key.chatId, key.telegramMessageId, state.replyMarkup, options);
          } else if (state.voiceFileId || audio) {
            edited = await telegram.editTelegramMessageRich(key.chatId, key.telegramMessageId,
              presentationRichMessage(state, Boolean(audio)), { ...options, audio: state.voiceFileId ? undefined : audio! });
            state.voiceAttached = true;
          } else {
            edited = await telegram.editTelegramMessageText(key.chatId, key.telegramMessageId, presentationText(state).slice(0, 4096), options);
          }
        } catch (error) {
          if (!String((error as Error)?.message).toLowerCase().includes('message is not modified')) {
            const classified = classifyTelegramDeliveryError(error);
            throw new BotRuntimeHandlerError(classified.errorCode, {
              retryable: classified.kind !== 'permanent', cause: error
            });
          }
          if (state.voiceFileId || audio) state.voiceAttached = true;
        }
        const fileId = voiceFileId(edited);
        if (fileId) { state.voiceFileId = fileId; audio = null; }
        await client.query(
          `UPDATE bot_message_presentations SET state = $2::jsonb, pending_audio = $3,
           content_dirty = false, updated_at = now() WHERE message_id = $1`,
          [key.messageId, JSON.stringify(state), audio]
        );
        return true;
      } finally {
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lock]); }
          catch (error) { releaseError = error as Error; }
        }
        client.release(releaseError);
      }
    }
  };
}
