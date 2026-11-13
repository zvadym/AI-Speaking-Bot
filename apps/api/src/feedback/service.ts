import type { PoolClient } from 'pg';

export interface FeedbackInput {
  chatId: number;
  botKey: string;
  username?: string | null;
  firstName?: string | null;
  messageId?: number | null;
  kind: 'text' | 'voice';
  feedbackText?: string | null;
  transcript?: string | null;
  telegramFileId?: string | null;
  source: 'telegram' | 'miniapp';
  category?: 'bug' | 'idea' | 'billing' | 'coach' | null;
  idempotencyKey: string;
}

/** One statement: the feedback, reopened thread and notification either all persist or none do. */
export async function saveFeedback(client: Pick<PoolClient, 'query'>, input: FeedbackInput): Promise<{ id: number; duplicate: boolean }> {
  if (!Number.isSafeInteger(input.chatId) || input.chatId <= 0 || !input.botKey ||
      !input.idempotencyKey.trim() || input.idempotencyKey.length > 200 ||
      (input.kind === 'text' && !input.feedbackText?.trim()) ||
      (input.kind === 'voice' && !input.telegramFileId?.trim())) {
    throw new Error('invalid_feedback_input');
  }
  const result = await client.query<{ id: string; duplicate: boolean }>(`WITH saved AS (
    INSERT INTO feedback (
      chat_id, username, first_name, message_id, kind, feedback_text, transcript,
      telegram_file_id, bot_key, source, category, idempotency_key
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      WHERE feedback.chat_id=EXCLUDED.chat_id AND feedback.bot_key=EXCLUDED.bot_key
        AND feedback.source=EXCLUDED.source AND feedback.kind=EXCLUDED.kind
    RETURNING id, chat_id, bot_key, (xmax <> 0) AS duplicate
  ), thread AS (
    INSERT INTO feedback_threads(chat_id,bot_key,archived_at,archived_by,user_last_read_at)
    SELECT chat_id,bot_key,NULL,NULL,NOW() FROM saved WHERE NOT duplicate
    ON CONFLICT (chat_id,bot_key) DO UPDATE SET archived_at=NULL,archived_by=NULL,user_last_read_at=NOW()
  ), notification AS (
    INSERT INTO feedback_notifications(feedback_id)
    SELECT id FROM saved ON CONFLICT (feedback_id) DO NOTHING
  ) SELECT id::text, duplicate FROM saved`, [
    input.chatId, input.username || null, input.firstName || null, input.messageId || null,
    input.kind, input.feedbackText?.trim() || null, input.transcript?.trim() || null,
    input.telegramFileId || null, input.botKey, input.source, input.category || null, input.idempotencyKey
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('feedback_idempotency_scope_mismatch');
  return { id: Number(row.id), duplicate: row.duplicate };
}
