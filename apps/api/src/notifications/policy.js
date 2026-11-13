import { env } from '../env.js';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';

export const WINBACK_ADMIN_TEST_ORIGIN = 'admin_test';

export const WINBACK_AUTOMATED_ORIGIN = 'automated';

const AUTOMATED_BEHAVIORAL_SUPPRESSION_TASK_TYPES = [
  'day1_return',
  'weekly_digest',
  'winback_d3',
  'winback_d7',
  'winback_d14',
  'free_limit_50'
];

function automatedMessageTestChatIdSet() {
  return new Set(
    Array.isArray(env.automatedMessageTestChatIds)
      ? env.automatedMessageTestChatIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : []
  );
}

export function getAutomatedMessageTestState() {
  const chatIds = [...automatedMessageTestChatIdSet()].sort((a, b) => a - b);
  return {
    active: chatIds.length > 0,
    chatIds
  };
}

export function automatedMessageTestChatIdsSqlParam() {
  const state = getAutomatedMessageTestState();
  return state.active ? state.chatIds : null;
}

export function isAutomatedMessageTestChatAllowed(chatId) {
  const state = getAutomatedMessageTestState();
  if (!state.active) return true;
  const normalizedChatId = Number(chatId);
  return Number.isFinite(normalizedChatId) && state.chatIds.includes(normalizedChatId);
}

export function buildManualTestScheduleKey() {
  return `manual_test:${Date.now().toString(36)}:${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export async function hasRecentAutomatedBehavioralSuppression(chatId) {
  const normalizedChatId = Number(chatId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0) {
    return { suppressed: false, code: null };
  }

  const [behavioralRes, feedbackRes, broadcastRes] = await Promise.all([
    pool.query(
      `SELECT 1
         FROM scheduled_task_dispatches
        WHERE chat_id = $1::bigint
          AND task_type = ANY($2::text[])
          AND status = 'sent'
          AND sent_at >= NOW() - interval '24 hours'
        LIMIT 1`,
      [normalizedChatId, AUTOMATED_BEHAVIORAL_SUPPRESSION_TASK_TYPES]
    ),
    pool.query(
      `SELECT 1
         FROM feedback_replies
        WHERE chat_id = $1::bigint
          AND created_at >= NOW() - interval '24 hours'
        LIMIT 1`,
      [normalizedChatId]
    ),
    pool.query(
      `SELECT 1
         FROM broadcast_recipients
        WHERE chat_id = $1::bigint
          AND status = 'sent'
          AND sent_at >= NOW() - interval '24 hours'
        LIMIT 1`,
      [normalizedChatId]
    )
  ]);

  if (behavioralRes.rows[0]) {
    return { suppressed: true, code: 'suppressed_recent_behavioral_reminder' };
  }
  if (feedbackRes.rows[0]) {
    return { suppressed: true, code: 'suppressed_recent_admin_feedback_reply' };
  }
  if (broadcastRes.rows[0]) {
    return { suppressed: true, code: 'suppressed_recent_broadcast' };
  }
  return { suppressed: false, code: null };
}
