import {
  WINBACK_AUTOMATED_ORIGIN,
  WINBACK_ADMIN_TEST_ORIGIN,
  isAutomatedMessageTestChatAllowed,
  hasRecentAutomatedBehavioralSuppression,
  buildManualTestScheduleKey,
  getAutomatedMessageTestState,
  automatedMessageTestChatIdsSqlParam
} from './policy.js';
import { getBotLocale, botConfigs } from './bot-context.js';
import { normalizeBotKey, normalizeOptionalText } from '../shared/normalization.js';
import { pool } from '../db.js';
import { createAppError } from '../core/errors.js';
import {
  hasSentScheduledDispatch,
  markScheduledDispatchAttemptStarted,
  finalizeScheduledDispatchAttempt
} from './dispatch.js';
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
import { QUEUE_FREE_LIMIT_HALF_SEND, defaultRetryOptions } from '../queue.js';
import { env } from '../env.js';

const FREE_LIMIT_HALF_TASK_TYPE = 'free_limit_50';

const FREE_LIMIT_HALF_TEST_TASK_TYPE = 'free_limit_50_test';

const FREE_LIMIT_HALF_SCAN_LIMIT = 500;

function resolveFreeLimitHalfTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? FREE_LIMIT_HALF_TEST_TASK_TYPE : FREE_LIMIT_HALF_TASK_TYPE;
}

const FREE_LIMIT_HALF_DEFAULT_LOCALE = {
  message_html: '<b>You’re already halfway through your free limit ✨</b>\nIf you want to keep going, PRO costs less than 2 cups of coffee per month.\n\nIt gives you more conversation practice.'
};

function resolveFreeLimitHalfLocale(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  const notifications = locale.notifications && typeof locale.notifications === 'object' ? locale.notifications : {};
  const raw = notifications.free_limit_50 && typeof notifications.free_limit_50 === 'object'
    ? notifications.free_limit_50
    : {};

  return {
    message_html: String(raw.message_html || FREE_LIMIT_HALF_DEFAULT_LOCALE.message_html).trim()
      || FREE_LIMIT_HALF_DEFAULT_LOCALE.message_html
  };
}

function resolveBotSubscriptionButtonLabel(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  return String(locale.btn_open_subscription || '').trim() || '💎 Open subscription';
}

function resolveBotWebAppUrl(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return null;
  const config = botConfigs[botKey] || botConfigs[botKeyRaw] || {};
  const raw = config?.telegram_presentation?.menu_button?.web_app_url;
  const value = String(raw || '').trim();
  return value || null;
}

function buildSubscriptionWebAppUrl(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  const raw = resolveBotWebAppUrl(botKey);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    url.pathname = '/subscription';
    if (botKey && !url.searchParams.get('bot-key')) {
      url.searchParams.set('bot-key', botKey);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

async function hasCompletedOnboarding(chatId, botKey) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM bot_onboarding_completion
      WHERE chat_id = $1
        AND bot_key = $2
      LIMIT 1`,
    [chatId, botKey]
  );
  return Boolean(rows[0]);
}

async function loadFreeLimitHalfBaseState(chatId, botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  const normalizedChatId = Number(chatId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !botKey) return null;

  const { rows } = await pool.query(
    `SELECT
       u.chat_id,
       u.inactive_reason,
       ub.bot_key,
       COALESCE(ub.is_active, true) AS is_active,
       CASE
         WHEN u.override_plan_tier IS NOT NULL
           AND u.override_expires_at IS NOT NULL
           AND NOW() < u.override_expires_at
           THEN u.override_plan_tier
         WHEN u.plan_expires_at IS NOT NULL
           AND NOW() < u.plan_expires_at
           THEN u.plan_tier
         ELSE 'free'
       END AS effective_tier
     FROM users u
     JOIN user_bots ub
       ON ub.chat_id = u.chat_id
     WHERE u.chat_id = $1::bigint
       AND ub.bot_key = $2::text
     LIMIT 1`,
    [normalizedChatId, botKey]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    chatId: normalizedChatId,
    botKey,
    inactiveReason: normalizeOptionalText(row.inactive_reason, 80),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    effectiveTier: String(row.effective_tier || 'free').trim().toLowerCase() || 'free'
  };
}

async function loadFreeLimitHalfEvent(chatId, botKeyRaw, scheduleKey) {
  const botKey = normalizeBotKey(botKeyRaw);
  const normalizedChatId = Number(chatId);
  const normalizedScheduleKey = String(scheduleKey || '').trim();
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !botKey || !normalizedScheduleKey) return null;

  const { rows } = await pool.query(
    `SELECT occurred_at, properties
       FROM action_events
      WHERE chat_id = $1::bigint
        AND bot_key = $2::text
        AND action_type = 'free_limit_half'
        AND COALESCE(properties->>'period_key', '') = $3::text
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [normalizedChatId, botKey, normalizedScheduleKey]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    occurredAt: row.occurred_at ? new Date(row.occurred_at) : null,
    properties: row.properties && typeof row.properties === 'object' ? row.properties : {}
  };
}

function buildFreeLimitHalfReplyMarkup(botKeyRaw) {
  const url = buildSubscriptionWebAppUrl(botKeyRaw);
  const text = resolveBotSubscriptionButtonLabel(botKeyRaw);
  if (!url || !text) return null;

  return {
    inline_keyboard: [
      [
        {
          text,
          web_app: { url }
        }
      ]
    ]
  };
}

async function loadFreeLimitHalfContext(chatId, botKey, { scheduleKey = null, origin = WINBACK_AUTOMATED_ORIGIN } = {}) {
  const baseState = await loadFreeLimitHalfBaseState(chatId, botKey);
  if (!baseState) return null;

  const event = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? null
    : await loadFreeLimitHalfEvent(chatId, botKey, scheduleKey);
  const locale = resolveFreeLimitHalfLocale(botKey);

  return {
    ...baseState,
    scheduleKey: String(scheduleKey || '').trim() || null,
    thresholdEvent: event,
    messageHtml: String(locale.message_html || '').trim(),
    replyMarkup: buildFreeLimitHalfReplyMarkup(botKey)
  };
}

async function hasActionEventSince(chatId, actionTypes, occurredAt) {
  const normalizedChatId = Number(chatId);
  const normalizedOccurredAt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const safeActionTypes = Array.isArray(actionTypes) ? actionTypes.map((value) => String(value || '').trim()).filter(Boolean) : [];
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !safeActionTypes.length || !Number.isFinite(normalizedOccurredAt.getTime())) {
    return false;
  }

  const { rows } = await pool.query(
    `SELECT 1
       FROM action_events
      WHERE chat_id = $1::bigint
        AND action_type = ANY($2::text[])
        AND occurred_at >= $3::timestamptz
      LIMIT 1`,
    [normalizedChatId, safeActionTypes, normalizedOccurredAt.toISOString()]
  );

  return Boolean(rows[0]);
}

async function evaluateFreeLimitHalfEligibility({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  scheduleKey = null
}) {
  if (!isAutomatedMessageTestChatAllowed(chatId)) {
    throw createAppError('chat_not_allowed_in_test_mode', 403, 'chat_not_allowed_in_test_mode', { retryable: false });
  }

  const normalizedScheduleKey = String(scheduleKey || '').trim();
  const context = await loadFreeLimitHalfContext(chatId, botKey, {
    scheduleKey: normalizedScheduleKey,
    origin
  });

  if (!context) {
    if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
      throw createAppError('user_bot_not_found', 404, 'user_bot_not_found', { retryable: false });
    }
    return { ok: false, code: 'user_bot_not_found', context: null };
  }

  if (!context.messageHtml) {
    throw createAppError('missing_free_limit_half_message', 502, 'missing_free_limit_half_message', { retryable: false });
  }
  if (!context.replyMarkup) {
    throw createAppError('missing_free_limit_half_cta', 502, 'missing_free_limit_half_cta', { retryable: false });
  }

  if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
    return { ok: true, code: null, context };
  }

  if (!context.isActive) return { ok: false, code: 'user_bot_inactive', context };
  if (context.inactiveReason) return { ok: false, code: 'permanent_telegram_inactive', context };
  if (context.effectiveTier !== 'free') return { ok: false, code: 'no_longer_free', context };
  if (!normalizedScheduleKey) return { ok: false, code: 'missing_schedule_key', context };
  if (!context.thresholdEvent || !(context.thresholdEvent.occurredAt instanceof Date) || !Number.isFinite(context.thresholdEvent.occurredAt.getTime())) {
    return { ok: false, code: 'missing_threshold_event', context };
  }

  if (!await hasCompletedOnboarding(context.chatId, context.botKey)) {
    return { ok: false, code: 'onboarding_not_sent', context };
  }
  if (await hasSentScheduledDispatch(FREE_LIMIT_HALF_TASK_TYPE, context.chatId, context.botKey, normalizedScheduleKey)) {
    return { ok: false, code: 'already_sent', context };
  }
  if (await hasActionEventSince(context.chatId, ['purchase_success'], context.thresholdEvent.occurredAt)) {
    return { ok: false, code: 'already_purchased', context };
  }
  if (await hasActionEventSince(context.chatId, ['paywall_shown'], context.thresholdEvent.occurredAt)) {
    return { ok: false, code: 'paywall_already_shown', context };
  }

  const suppression = await hasRecentAutomatedBehavioralSuppression(context.chatId);
  if (suppression.suppressed) {
    return { ok: false, code: suppression.code, context };
  }

  return { ok: true, code: null, context };
}

async function sendFreeLimitHalfNotificationCore({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  taskType = resolveFreeLimitHalfTaskType(origin),
  scheduleKey = null
} = {}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (String(scheduleKey || '').trim() || buildManualTestScheduleKey())
    : String(scheduleKey || '').trim();

  const eligibility = await evaluateFreeLimitHalfEligibility({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    origin,
    scheduleKey: effectiveScheduleKey
  });

  if (!eligibility.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      origin,
      reminder_type: FREE_LIMIT_HALF_TASK_TYPE
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: eligibility.code,
      payloadJson: {
        origin,
        reminder_type: FREE_LIMIT_HALF_TASK_TYPE,
        skipped_reason: eligibility.code
      }
    });
    return null;
  }

  const context = eligibility.context;
  await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
    origin,
    reminder_type: FREE_LIMIT_HALF_TASK_TYPE
  });

  try {
    const telegramResult = await sendTelegramTextMessage(
      normalizedChatId,
      sanitizeTelegramHtml(context.messageHtml),
      {
        botKey: normalizedBotKey,
        parseMode: 'HTML',
        replyMarkup: context.replyMarkup
      }
    );
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;

    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'sent',
      telegramMessageId,
      payloadJson: {
        origin,
        reminder_type: FREE_LIMIT_HALF_TASK_TYPE,
        threshold_reached_at: context.thresholdEvent?.occurredAt ? context.thresholdEvent.occurredAt.toISOString() : null,
        message_html: context.messageHtml,
        subscription_web_app_url: context.replyMarkup?.inline_keyboard?.[0]?.[0]?.web_app?.url || null
      }
    });
    await updateUserDeliveryState(normalizedChatId, {
      status: 'sent',
      lastError: null,
      inactiveReason: null,
      botKey: normalizedBotKey
    });

    return {
      ok: true,
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      taskType,
      scheduleKey: effectiveScheduleKey,
      telegramMessageId,
      allowlistActive: getAutomatedMessageTestState().active
    };
  } catch (error) {
    const lastError = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'telegram_send_failed';
    const inactiveReason = classifyPermanentTelegramFailure(error);
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError,
      payloadJson: {
        origin,
        reminder_type: FREE_LIMIT_HALF_TASK_TYPE,
        inactive_reason: inactiveReason || null
      }
    });
    await updateUserDeliveryState(normalizedChatId, {
      status: 'failed',
      lastError,
      inactiveReason,
      botKey: normalizedBotKey
    });

    throw createAppError('telegram_send_failed', 502, lastError, {
      retryable: !inactiveReason,
      inactiveReason,
      cause: error
    });
  }
}

async function scanEligibleFreeLimitHalfUsers() {
  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const { rows } = await pool.query(
    `SELECT
       e.chat_id,
       e.bot_key,
       COALESCE(e.properties->>'period_key', '') AS schedule_key,
       e.occurred_at
     FROM action_events e
     JOIN user_bots ub
       ON ub.chat_id = e.chat_id
      AND ub.bot_key = e.bot_key
     JOIN users u
       ON u.chat_id = e.chat_id
     WHERE e.action_type = 'free_limit_half'
       AND COALESCE(e.bot_key, '') <> ''
       AND COALESCE(e.properties->>'period_key', '') <> ''
       AND COALESCE(ub.is_active, true) = true
       AND CASE
             WHEN u.override_plan_tier IS NOT NULL
               AND u.override_expires_at IS NOT NULL
               AND NOW() < u.override_expires_at
               THEN u.override_plan_tier
             WHEN u.plan_expires_at IS NOT NULL
               AND NOW() < u.plan_expires_at
               THEN u.plan_tier
             ELSE 'free'
           END = 'free'
       AND ($1::bigint[] IS NULL OR e.chat_id = ANY($1::bigint[]))
       AND EXISTS (
         SELECT 1
         FROM bot_onboarding_completion onboarding
         WHERE onboarding.bot_key = e.bot_key
           AND onboarding.chat_id = e.chat_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $2::text
           AND std.bot_key = e.bot_key
           AND std.chat_id = e.chat_id
           AND std.schedule_key = COALESCE(e.properties->>'period_key', '')
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1
         FROM action_events a
         WHERE a.chat_id = e.chat_id
           AND a.action_type = 'purchase_success'
           AND a.occurred_at >= e.occurred_at
       )
       AND NOT EXISTS (
         SELECT 1
         FROM action_events a
         WHERE a.chat_id = e.chat_id
           AND a.action_type = 'paywall_shown'
           AND a.occurred_at >= e.occurred_at
       )
     ORDER BY e.occurred_at ASC, e.chat_id ASC, e.bot_key ASC
     LIMIT $3::int`,
    [
      testChatIds,
      FREE_LIMIT_HALF_TASK_TYPE,
      FREE_LIMIT_HALF_SCAN_LIMIT
    ]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key),
    scheduleKey: String(row.schedule_key || '').trim(),
    taskType: FREE_LIMIT_HALF_TASK_TYPE
  })).filter((row) => Number.isFinite(row.chatId) && row.chatId > 0 && row.botKey && row.scheduleKey);
}

export async function sendAdminTestFreeLimitHalfReminder({ chatId, botKey }) {
  const result = await sendFreeLimitHalfNotificationCore({
    chatId,
    botKey,
    origin: WINBACK_ADMIN_TEST_ORIGIN,
    taskType: resolveFreeLimitHalfTaskType(WINBACK_ADMIN_TEST_ORIGIN),
    scheduleKey: buildManualTestScheduleKey()
  });

  if (!result) {
    throw createAppError('free_limit_half_send_failed', 502, 'free_limit_half_send_failed', { retryable: false });
  }

  return {
    ok: true,
    chat_id: result.chatId,
    bot_key: result.botKey,
    reminder_type: FREE_LIMIT_HALF_TASK_TYPE,
    telegram_message_id: result.telegramMessageId,
    allowlist_active: result.allowlistActive,
    task_type: result.taskType,
    schedule_key: result.scheduleKey
  };
}

async function enqueueFreeLimitHalfSend(boss, { chatId, botKey, scheduleKey, taskType = FREE_LIMIT_HALF_TASK_TYPE }) {
  return boss.send(
    QUEUE_FREE_LIMIT_HALF_SEND,
    { chatId, botKey, scheduleKey, taskType },
    {
      ...defaultRetryOptions(),
      singletonKey: `free_limit_half:${taskType}:${botKey}:${chatId}:${scheduleKey}`
    }
  );
}

export async function handleFreeLimitHalfScan(jobs, boss) {
  for (const job of jobs) {
    const eligibleUsers = await scanEligibleFreeLimitHalfUsers();
    console.log('free-limit-half-scan', {
      jobId: job.id,
      eligibleCount: eligibleUsers.length
    });

    for (const user of eligibleUsers) {
      await enqueueFreeLimitHalfSend(boss, user);
    }
  }
}

export async function handleFreeLimitHalfSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const taskType = String(job.data?.taskType || '').trim() || FREE_LIMIT_HALF_TASK_TYPE;
    const scheduleKey = String(job.data?.scheduleKey || '').trim();
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !scheduleKey) {
      continue;
    }

    try {
      const result = await sendFreeLimitHalfNotificationCore({
        chatId,
        botKey,
        origin: WINBACK_AUTOMATED_ORIGIN,
        taskType,
        scheduleKey
      });

      if (!result) {
        console.log('free-limit-half-send:skipped', {
          jobId: job.id,
          chatId,
          botKey,
          scheduleKey
        });
        continue;
      }

      console.log('free-limit-half-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        taskType,
        telegramMessageId: result.telegramMessageId
      });
    } catch (error) {
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);
      const detail = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'free_limit_half_send_failed';

      console.warn('free-limit-half-send:failed', {
        jobId: job.id,
        chatId,
        botKey,
        taskType,
        scheduleKey,
        inactiveReason: error?.inactiveReason || null,
        isFinalAttempt,
        error: detail
      });

      if (error?.retryable && !error?.inactiveReason && !isFinalAttempt) {
        throw error.cause || error;
      }
    }
  }
}
