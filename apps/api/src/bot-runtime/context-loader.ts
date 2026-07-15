import type { KeyboardStateRow, Queryable } from './contracts.js';

interface PendingFeedbackRow extends Record<string, unknown> {
  pending?: unknown;
}

export async function fetchKeyboardState(
  pool: Queryable,
  chatId: number,
  botKey: string
): Promise<KeyboardStateRow> {
  const { rows } = await pool.query<KeyboardStateRow>(
    `SELECT
       ub.level,
       ub.reply_mode,
       onboarding.completed_at AS onboarding_complete_at,
       COALESCE(ub.topic_enabled, false) AS topic_enabled,
       ub.topic_template_id,
       ub.topic_pack_json,
       ub.topic_pinned_message_id,
       COALESCE(up.xp_total, 0)::int AS xp_total,
       FLOOR(COALESCE(up.xp_total, 0) / 200.0)::int + 1 AS xp_level
     FROM user_bots ub
     LEFT JOIN user_progress up
       ON up.chat_id = ub.chat_id
      AND up.bot_key = ub.bot_key
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

export async function fetchPendingFeedbackState(
  pool: Queryable,
  chatId: number,
  botKey: string
): Promise<boolean> {
  const { rows } = await pool.query<PendingFeedbackRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM pending_feedback
       WHERE chat_id = $1::bigint
         AND bot_key = $2
         AND expires_at > NOW()
     ) AS pending`,
    [chatId, botKey]
  );
  return Boolean(rows[0]?.pending);
}
