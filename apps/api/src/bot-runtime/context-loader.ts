import type { KeyboardStateRow, Queryable } from './contracts.js';

export async function fetchKeyboardState(
  pool: Queryable,
  chatId: number,
  botKey: string
): Promise<KeyboardStateRow> {
  const { rows } = await pool.query<KeyboardStateRow>(
    `SELECT
       ub.level,
       ub.reply_mode,
       onboarding.completed_at AS onboarding_complete_at
     FROM user_bots ub
     LEFT JOIN bot_onboarding_completion onboarding
       ON onboarding.chat_id = ub.chat_id
      AND onboarding.bot_key = ub.bot_key
     WHERE ub.chat_id = $1
       AND ub.bot_key = $2
     LIMIT 1`,
    [chatId, botKey]
  );
  return rows[0] || {};
}

export type FeedbackReplyState = 'pending' | 'expired' | null;

export async function fetchFeedbackReplyState(
  pool: Queryable, chatId: number, botKey: string, replyToMessageId?: number | null
): Promise<FeedbackReplyState> {
  if (!Number.isSafeInteger(replyToMessageId) || Number(replyToMessageId) <= 0) return null;
  const { rows } = await pool.query<{ pending: boolean }>(
    `SELECT (pf.status = 'awaiting' AND pf.expires_at > NOW()) AS pending
       FROM pending_feedback pf
       LEFT JOIN bot_update_deliveries d ON d.decision_id=pf.session_id
         AND d.step_key='settings:feedback-prompt:v1' AND d.status='delivered'
      WHERE pf.chat_id = $1::bigint AND pf.bot_key = $2 AND COALESCE(pf.prompt_message_id,d.telegram_message_id) = $3::bigint
      ORDER BY pf.created_at DESC LIMIT 1`,
    [chatId, botKey, replyToMessageId]
  );
  return rows[0] ? (rows[0].pending ? 'pending' : 'expired') : null;
}

export async function fetchPendingFeedbackState(
  pool: Queryable, chatId: number, botKey: string, replyToMessageId?: number | null
): Promise<boolean> {
  return (await fetchFeedbackReplyState(pool, chatId, botKey, replyToMessageId)) === 'pending';
}
