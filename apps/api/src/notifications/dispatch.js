import { pool } from '../db.js';

export async function hasSentScheduledDispatch(taskType, chatId, botKey, scheduleKey) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM scheduled_task_dispatches
      WHERE task_type = $1
        AND bot_key = $2
        AND chat_id = $3
        AND schedule_key = $4
        AND status = 'sent'
        AND sent_at IS NOT NULL
      LIMIT 1`,
    [taskType, botKey, chatId, scheduleKey]
  );
  return Boolean(rows[0]);
}

export async function markScheduledDispatchAttemptStarted(taskType, chatId, botKey, scheduleKey, payloadJson = {}) {
  await pool.query(
    `INSERT INTO scheduled_task_dispatches (
       task_type,
       bot_key,
       chat_id,
       schedule_key,
       status,
       claimed_at,
       claim_expires_at,
       attempts,
       last_error,
       payload_json,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       'claimed',
       NOW(),
       NULL,
       1,
       NULL,
       $5::jsonb,
       NOW(),
       NOW()
     )
     ON CONFLICT (task_type, bot_key, chat_id, schedule_key) DO UPDATE
       SET status = CASE
             WHEN scheduled_task_dispatches.status = 'sent' THEN scheduled_task_dispatches.status
             ELSE 'claimed'
           END,
           claimed_at = CASE
             WHEN scheduled_task_dispatches.status = 'sent' THEN scheduled_task_dispatches.claimed_at
             ELSE NOW()
           END,
           claim_expires_at = NULL,
           attempts = CASE
             WHEN scheduled_task_dispatches.status = 'sent' THEN scheduled_task_dispatches.attempts
             ELSE scheduled_task_dispatches.attempts + 1
           END,
           last_error = CASE
             WHEN scheduled_task_dispatches.status = 'sent' THEN scheduled_task_dispatches.last_error
             ELSE NULL
           END,
           payload_json = CASE
             WHEN scheduled_task_dispatches.status = 'sent' THEN scheduled_task_dispatches.payload_json
             ELSE COALESCE(scheduled_task_dispatches.payload_json, '{}'::jsonb) || $5::jsonb
           END,
           updated_at = NOW()`,
    [taskType, botKey, chatId, scheduleKey, JSON.stringify(payloadJson || {})]
  );
}

export async function finalizeScheduledDispatchAttempt(
  taskType,
  chatId,
  botKey,
  scheduleKey,
  {
    status,
    lastError = null,
    telegramMessageId = null,
    payloadJson = null
  } = {}
) {
  await pool.query(
    `UPDATE scheduled_task_dispatches
        SET status = $5::text,
            claim_expires_at = NULL,
            last_error = $6::text,
            telegram_message_id = CASE
              WHEN $7::bigint IS NOT NULL THEN $7::bigint
              ELSE telegram_message_id
            END,
            sent_at = CASE
              WHEN $5::text = 'sent' THEN COALESCE(sent_at, NOW())
              ELSE sent_at
            END,
            payload_json = CASE
              WHEN $8::jsonb IS NULL THEN payload_json
              ELSE COALESCE(payload_json, '{}'::jsonb) || $8::jsonb
            END,
            updated_at = NOW()
      WHERE task_type = $1
        AND bot_key = $2
        AND chat_id = $3
        AND schedule_key = $4`,
    [
      taskType,
      botKey,
      chatId,
      scheduleKey,
      status,
      lastError,
      telegramMessageId,
      payloadJson ? JSON.stringify(payloadJson) : null
    ]
  );
}
