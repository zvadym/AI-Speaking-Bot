import { automatedMessageTestChatIdsSqlParam } from './policy.js';
import { pool } from '../db.js';
import { env } from '../env.js';
import { normalizeBotKey } from '../shared/normalization.js';
import { QUEUE_ONBOARDING_COMPLETE_SEND, defaultRetryOptions } from '../queue.js';
import { getBotLocale } from './bot-context.js';
import {
  resolveTelegramBotToken,
  callTelegramApi,
  sendTelegramTextMessage,
  sendTelegramPhotoMessage,
  sendTelegramVideoMessage,
  updateUserDeliveryState
} from './telegram.js';
import {
  sanitizeTelegramHtml,
  sanitizeErrorText,
  classifyPermanentTelegramFailure
} from '../shared/telegram-delivery.js';

const ONBOARDING_TASK_TYPE = 'onboarding_complete';

const ONBOARDING_SCHEDULE_KEY = 'once';

function buildOnboardingReplyMarkup(locale) {
  return {
    keyboard: [[{ text: `· ⚙️ ${String(locale.settings?.title || 'Settings').trim() || 'Settings'}` }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function scanEligibleOnboardingUsers() {
  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const { rows } = await pool.query(
    `SELECT
       ub.chat_id,
       ub.bot_key
     FROM user_bots ub
     JOIN LATERAL (
       SELECT m.created_at
       FROM messages m
       WHERE m.chat_id = ub.chat_id
         AND m.bot_key = ub.bot_key
         AND m.role = 'user'
       ORDER BY m.id DESC
       LIMIT 1
     ) last_user ON true
     WHERE COALESCE(ub.is_active, true) = true
       AND NOT EXISTS (
         SELECT 1
         FROM bot_onboarding_sessions session
         WHERE session.chat_id = ub.chat_id
           AND session.bot_key = ub.bot_key
       )
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $1
           AND std.schedule_key = $2
           AND std.bot_key = ub.bot_key
           AND std.chat_id = ub.chat_id
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
       AND last_user.created_at <= NOW() - ($3::int * interval '1 minute')
       AND ($5::bigint[] IS NULL OR ub.chat_id = ANY($5::bigint[]))
     ORDER BY last_user.created_at ASC, ub.chat_id ASC, ub.bot_key ASC
     LIMIT $4::int`,
    [
      ONBOARDING_TASK_TYPE,
      ONBOARDING_SCHEDULE_KEY,
      env.onboardingCompleteIdleMinutes,
      env.onboardingCompleteScanLimit,
      testChatIds
    ]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key)
  }));
}

async function hasSentOnboardingDispatch(chatId, botKey) {
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
    [ONBOARDING_TASK_TYPE, botKey, chatId, ONBOARDING_SCHEDULE_KEY]
  );
  return Boolean(rows[0]);
}

async function markOnboardingAttemptStarted(chatId, botKey) {
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
       '{}'::jsonb,
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
           updated_at = NOW()`,
    [ONBOARDING_TASK_TYPE, botKey, chatId, ONBOARDING_SCHEDULE_KEY]
  );
}

async function finalizeOnboardingAttempt(chatId, botKey, { status, lastError = null, telegramMessageId = null }) {
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
            updated_at = NOW()
      WHERE task_type = $1
        AND bot_key = $2
        AND chat_id = $3
        AND schedule_key = $4`,
    [
      ONBOARDING_TASK_TYPE,
      botKey,
      chatId,
      ONBOARDING_SCHEDULE_KEY,
      status,
      lastError,
      telegramMessageId
    ]
  );
}

async function loadOnboardingState(chatId, botKey) {
  const { rows } = await pool.query(
    `SELECT
       ub.level,
       ub.reply_mode
     FROM user_bots ub
     WHERE ub.chat_id = $1
       AND ub.bot_key = $2
       AND COALESCE(ub.is_active, true) = true
     LIMIT 1`,
    [chatId, botKey]
  );

  return rows[0] || null;
}

async function enqueueOnboardingSend(boss, { chatId, botKey }) {
  return boss.send(
    QUEUE_ONBOARDING_COMPLETE_SEND,
    { chatId, botKey },
    {
      ...defaultRetryOptions(),
      singletonKey: `onboarding_complete:${botKey}:${chatId}`
    }
  );
}

export async function handleOnboardingCompleteScan(jobs, boss) {
  for (const job of jobs) {
    const eligibleUsers = await scanEligibleOnboardingUsers();
    console.log('onboarding-complete-scan', {
      jobId: job.id,
      eligibleCount: eligibleUsers.length
    });

    for (const user of eligibleUsers) {
      await enqueueOnboardingSend(boss, user);
    }
  }
}

export async function handleOnboardingCompleteSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) continue;

    if (await hasSentOnboardingDispatch(chatId, botKey)) {
      continue;
    }

    const locale = getBotLocale(botKey);
    const onboardingText = String(locale.onboarding_complete_full_text || '').trim();
    if (!onboardingText) {
      throw new Error(`missing_onboarding_complete_locale:${botKey}`);
    }

    const state = await loadOnboardingState(chatId, botKey);
    if (!state) {
      continue;
    }

    await markOnboardingAttemptStarted(chatId, botKey);

    try {
      const replyMarkup = buildOnboardingReplyMarkup(locale);
      const telegramResult = await sendTelegramTextMessage(chatId, sanitizeTelegramHtml(onboardingText), {
        botKey,
        parseMode: 'HTML',
        replyMarkup
      });
      const messageId = Number(telegramResult?.message_id ?? 0);
      const telegramMessageId = Number.isFinite(messageId) && messageId > 0 ? messageId : null;

      await finalizeOnboardingAttempt(chatId, botKey, {
        status: 'sent',
        telegramMessageId
      });
      await updateUserDeliveryState(chatId, { status: 'sent', lastError: null, inactiveReason: null, botKey });

      console.log('onboarding-complete-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        telegramMessageId
      });
    } catch (error) {
      const lastError = sanitizeErrorText(error?.message || String(error)) || 'telegram_send_failed';
      const inactiveReason = classifyPermanentTelegramFailure(error);
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);

      await finalizeOnboardingAttempt(chatId, botKey, {
        status: 'failed',
        lastError
      });
      await updateUserDeliveryState(chatId, {
        status: 'failed',
        lastError,
        inactiveReason,
        botKey
      });

      console.warn('onboarding-complete-send:failed', {
        jobId: job.id,
        chatId,
        botKey,
        inactiveReason,
        isFinalAttempt,
        error: lastError
      });

      if (!inactiveReason && !isFinalAttempt) {
        throw error;
      }
    }
  }
}
