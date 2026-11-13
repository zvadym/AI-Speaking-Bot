import { randomUUID as createRandomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP
} from './progress-queue.js';

const ROTATE_INTERVAL_SECONDS = 5;
const TIMEOUT_SECONDS = 60;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_LENGTH = 4096;

interface ProgressBoss {
  send(name: string, data: object, options: Record<string, unknown>): Promise<string | null>;
}

export interface ProgressTelegramClient {
  sendTelegramTextMessage(
    chatId: number,
    text: string,
    options: { botKey: string }
  ): Promise<{ message_id?: unknown } | null>;
  editTelegramMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: { botKey: string }
  ): Promise<unknown>;
  deleteTelegramMessage(
    chatId: number,
    messageId: number,
    options: { botKey: string }
  ): Promise<unknown>;
}

interface ProgressStateRow extends Record<string, unknown> {
  chat_id: unknown;
  bot_key: unknown;
  stop_flag: unknown;
  session_id: unknown;
  message_id: unknown;
  started_at: unknown;
}

export interface ProgressSession {
  sessionId: string;
  messageId: number;
}

export interface ProgressRotationInput {
  chatId: number;
  botKey: string;
  sessionId: string;
  waitingText: string;
  messages: string[];
  step: number;
}

export interface ProgressService {
  start(input: {
    chatId: number;
    botKey: string;
    waitingText: unknown;
    messages: unknown;
  }): Promise<ProgressSession>;
  stop(input: {
    chatId: number;
    botKey: string;
    sessionId?: string | null;
  }): Promise<boolean>;
  rotate(input: unknown): Promise<boolean>;
  timeout(input: unknown): Promise<boolean>;
}

function normalizeChatId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBotKey(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z]{2,8}-[a-z]{2,8}$/u.test(normalized) ? normalized : '';
}

function normalizeSessionId(value: unknown): string {
  return String(value || '').trim().slice(0, 128);
}

function normalizeMessageId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeProgressText(value: unknown): string {
  return String(value || '').trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function normalizeProgressMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeProgressText)
    .filter(Boolean)
    .slice(0, MAX_MESSAGES);
}

function shuffleMessages(messages: string[], random: () => number): string[] {
  const shuffled = [...messages];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function telegramErrorText(error: unknown): string {
  const value = error as { telegramDescription?: unknown; message?: unknown };
  return String(value?.telegramDescription || value?.message || error || '').toLowerCase();
}

function isTelegramMessageGone(error: unknown): boolean {
  const message = telegramErrorText(error);
  return (
    message.includes('message to edit not found') ||
    message.includes('message to delete not found') ||
    message.includes('message identifier is not specified') ||
    message.includes("message can't be deleted") ||
    message.includes('message can not be edited')
  );
}

function isTelegramNotModified(error: unknown): boolean {
  return telegramErrorText(error).includes('message is not modified');
}

function rowState(row: ProgressStateRow | undefined) {
  if (!row) return null;
  const startedAt = row.started_at instanceof Date
    ? row.started_at
    : new Date(String(row.started_at || ''));
  return {
    stopped: row.stop_flag === true,
    sessionId: normalizeSessionId(row.session_id),
    messageId: normalizeMessageId(row.message_id),
    startedAt: Number.isNaN(startedAt.getTime()) ? null : startedAt
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original state-transition error.
  }
}

export function createProgressService({
  pool,
  boss,
  telegramClient,
  randomUUID = createRandomUUID,
  random = Math.random
}: {
  pool: Pool;
  boss: ProgressBoss;
  telegramClient: ProgressTelegramClient;
  randomUUID?: () => string;
  random?: () => number;
}): ProgressService {
  async function enqueueRotation(input: ProgressRotationInput): Promise<string> {
    const jobId = await boss.send(QUEUE_LOADER_ROTATE, input, {
      retryLimit: 0,
      startAfter: ROTATE_INTERVAL_SECONDS,
      singletonKey: `loader_rotate:${input.botKey}:${input.chatId}:${input.sessionId}:${input.step}`
    });
    if (!jobId) throw new Error('progress_rotation_enqueue_failed');
    return jobId;
  }

  async function enqueueTimeout(chatId: number, botKey: string, sessionId: string): Promise<string> {
    const jobId = await boss.send(
      QUEUE_LOADER_TIMEOUT_CLEANUP,
      { chatId, botKey, sessionId },
      {
        retryLimit: 0,
        startAfter: TIMEOUT_SECONDS,
        singletonKey: `loader_timeout:${botKey}:${chatId}:${sessionId}`
      }
    );
    if (!jobId) throw new Error('progress_timeout_enqueue_failed');
    return jobId;
  }

  async function fetchState(
    queryable: Pool | PoolClient,
    chatId: number,
    botKey: string,
    lock = false
  ) {
    const result = await queryable.query<ProgressStateRow>(
      `SELECT chat_id, bot_key, stop_flag, session_id, message_id, started_at
       FROM loader_flags
       WHERE chat_id = $1 AND bot_key = $2
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [chatId, botKey]
    );
    return rowState(result.rows[0]);
  }

  async function deleteMessageBestEffort(
    chatId: number,
    botKey: string,
    messageId: number,
    event: string
  ): Promise<void> {
    try {
      await telegramClient.deleteTelegramMessage(chatId, messageId, { botKey });
    } catch (error) {
      if (!isTelegramMessageGone(error)) {
        console.warn(event, {
          chatId,
          botKey,
          messageId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  async function stop({
    chatId: rawChatId,
    botKey: rawBotKey,
    sessionId: rawSessionId = null
  }: {
    chatId: number;
    botKey: string;
    sessionId?: string | null;
  }): Promise<boolean> {
    const chatId = normalizeChatId(rawChatId);
    const botKey = normalizeBotKey(rawBotKey);
    const sessionId = rawSessionId === null ? null : normalizeSessionId(rawSessionId);
    if (!chatId || !botKey || (rawSessionId !== null && !sessionId)) return false;

    const client = await pool.connect();
    let messageId: number | null = null;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${botKey}:${chatId}`]
      );
      const state = await fetchState(client, chatId, botKey, true);
      if (!state || (sessionId && state.sessionId !== sessionId)) {
        await client.query('COMMIT');
        return false;
      }
      messageId = state.messageId;
      await client.query(
        `UPDATE loader_flags
         SET stop_flag = true, message_id = NULL, updated_at = NOW()
         WHERE chat_id = $1 AND bot_key = $2 AND ($3::text IS NULL OR session_id = $3)`,
        [chatId, botKey, sessionId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }

    if (messageId) {
      await deleteMessageBestEffort(chatId, botKey, messageId, 'progress-stop:delete-failed');
    }
    return true;
  }

  async function start({
    chatId: rawChatId,
    botKey: rawBotKey,
    waitingText: rawWaitingText,
    messages: rawMessages
  }: {
    chatId: number;
    botKey: string;
    waitingText: unknown;
    messages: unknown;
  }): Promise<ProgressSession> {
    const chatId = normalizeChatId(rawChatId);
    const botKey = normalizeBotKey(rawBotKey);
    const waitingText = normalizeProgressText(rawWaitingText);
    const messages = shuffleMessages(normalizeProgressMessages(rawMessages), random);
    if (!chatId || !botKey || !waitingText) throw new Error('progress_start_input_invalid');

    const client = await pool.connect();
    let sessionId = '';
    let messageId: number | null = null;
    let previousMessageId: number | null = null;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${botKey}:${chatId}`]
      );
      const previous = await fetchState(client, chatId, botKey, true);
      previousMessageId = previous?.messageId || null;

      const telegramResult = await telegramClient.sendTelegramTextMessage(
        chatId,
        waitingText,
        { botKey }
      );
      messageId = normalizeMessageId(telegramResult?.message_id);
      if (!messageId) throw new Error('progress_telegram_message_missing');
      sessionId = normalizeSessionId(randomUUID());
      if (!sessionId) throw new Error('progress_session_id_missing');

      await client.query(
        `INSERT INTO loader_flags (
           chat_id, bot_key, session_id, message_id, stop_flag, started_at, updated_at
         ) VALUES ($1, $2, $3, $4, false, NOW(), NOW())
         ON CONFLICT (chat_id, bot_key) DO UPDATE SET
           session_id = EXCLUDED.session_id,
           message_id = EXCLUDED.message_id,
           stop_flag = false,
           started_at = NOW(),
           updated_at = NOW()`,
        [chatId, botKey, sessionId, messageId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      if (messageId) {
        await deleteMessageBestEffort(
          chatId,
          botKey,
          messageId,
          'progress-start:rollback-delete-failed'
        );
      }
      throw error;
    } finally {
      client.release();
    }

    if (previousMessageId && previousMessageId !== messageId) {
      await deleteMessageBestEffort(
        chatId,
        botKey,
        previousMessageId,
        'progress-start:previous-delete-failed'
      );
    }

    try {
      if (messages.length > 0) {
        await enqueueRotation({ chatId, botKey, sessionId, waitingText, messages, step: 0 });
      }
      await enqueueTimeout(chatId, botKey, sessionId);
    } catch (error) {
      await stop({ chatId, botKey, sessionId });
      throw error;
    }
    return { sessionId, messageId: messageId as number };
  }

  async function rotate(rawInput: unknown): Promise<boolean> {
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : {};
    const chatId = normalizeChatId(input.chatId);
    const botKey = normalizeBotKey(input.botKey);
    const sessionId = normalizeSessionId(input.sessionId);
    const waitingText = normalizeProgressText(input.waitingText);
    const messages = normalizeProgressMessages(input.messages);
    const step = Number(input.step);
    if (!chatId || !botKey || !sessionId || !Number.isInteger(step) || step < 0) return false;

    const state = await fetchState(pool, chatId, botKey);
    if (!state || state.stopped || state.sessionId !== sessionId || !state.messageId) return false;
    const ageMs = state.startedAt ? Date.now() - state.startedAt.getTime() : Number.POSITIVE_INFINITY;
    if (ageMs >= TIMEOUT_SECONDS * 1000) {
      await stop({ chatId, botKey, sessionId });
      return false;
    }

    if (messages.length > 0) {
      let text = messages[step % messages.length] || '';
      if (messages.length > 1 && text === waitingText) {
        text = messages[(step + 1) % messages.length] || '';
      }
      if (text) {
        try {
          await telegramClient.editTelegramMessageText(chatId, state.messageId, text, { botKey });
        } catch (error) {
          if (isTelegramMessageGone(error)) {
            await stop({ chatId, botKey, sessionId });
            return false;
          }
          if (!isTelegramNotModified(error)) {
            console.warn('progress-rotate:edit-failed', {
              chatId,
              botKey,
              sessionId,
              step,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    const nextStep = step + 1;
    if (messages.length > 0 && (nextStep + 1) * ROTATE_INTERVAL_SECONDS < TIMEOUT_SECONDS) {
      await enqueueRotation({
        chatId,
        botKey,
        sessionId,
        waitingText,
        messages,
        step: nextStep
      });
    }
    return true;
  }

  async function timeout(rawInput: unknown): Promise<boolean> {
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput as Record<string, unknown>
      : {};
    const chatId = normalizeChatId(input.chatId);
    const botKey = normalizeBotKey(input.botKey);
    const sessionId = normalizeSessionId(input.sessionId);
    if (!chatId || !botKey || !sessionId) return false;
    return stop({ chatId, botKey, sessionId });
  }

  return { start, stop, rotate, timeout };
}
