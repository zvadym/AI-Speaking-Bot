import { normalizeBotKey } from '../shared/normalization.js';
import {
  buildPreparedUpdate,
  normalizeTelegramUpdate
} from './update-preparation.js';

export async function fetchKeyboardState(pool, chatId, botKey) {
  const { rows } = await pool.query(
    `SELECT
       ub.level,
       ub.reply_mode,
       onboarding.onboarding_complete_at,
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
     LEFT JOIN LATERAL (
       SELECT MIN(std.sent_at) AS onboarding_complete_at
       FROM scheduled_task_dispatches std
       WHERE std.chat_id = ub.chat_id
         AND std.bot_key = ub.bot_key
         AND std.task_type = 'onboarding_complete'
         AND std.status = 'sent'
         AND std.sent_at IS NOT NULL
     ) onboarding ON true
     WHERE ub.chat_id = $1
       AND ub.bot_key = $2
     LIMIT 1`,
    [chatId, botKey]
  );
  return rows[0] || {};
}

export async function fetchPendingFeedbackState(pool, chatId, botKey) {
  const { rows } = await pool.query(
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

export async function prepareBotUpdate(ctx, { botKey: rawBotKey, telegramUpdate }) {
  const botKey = normalizeBotKey(rawBotKey);
  const updateInfo = normalizeTelegramUpdate(telegramUpdate);
  const locale = ctx.getBotLocale(botKey);
  let keyboardState = {};
  let pendingFeedback = false;

  if (botKey && updateInfo.chat_id && updateInfo.is_private && !updateInfo.sender.is_bot) {
    [keyboardState, pendingFeedback] = await Promise.all([
      fetchKeyboardState(ctx.pool, updateInfo.chat_id, botKey),
      fetchPendingFeedbackState(ctx.pool, updateInfo.chat_id, botKey)
    ]);
  }

  return buildPreparedUpdate({
    botKey,
    telegramUpdate,
    keyboardState,
    locale,
    pendingFeedback
  });
}

