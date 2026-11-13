import {
  WINBACK_AUTOMATED_ORIGIN,
  WINBACK_ADMIN_TEST_ORIGIN,
  automatedMessageTestChatIdsSqlParam,
  isAutomatedMessageTestChatAllowed,
  hasRecentAutomatedBehavioralSuppression,
  buildManualTestScheduleKey,
  getAutomatedMessageTestState
} from './policy.js';
import { getBotLocale } from './bot-context.js';
import { pool } from '../db.js';
import { normalizeBotKey, normalizeOptionalText } from '../shared/normalization.js';
import {
  normalizeReplyMode,
  WINBACK_REPLY_MODE_VOICE,
  countSentences,
  countEmoji,
  containsHtmlLikeTags,
  stableVariantIndex,
  applyTemplateSlots
} from './messages.js';
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
import { sanitizeErrorText, classifyPermanentTelegramFailure } from '../shared/telegram-delivery.js';
import { QUEUE_DAY1_RETURN_SEND, defaultRetryOptions } from '../queue.js';
import { env } from '../env.js';

const DAY1_RETURN_TASK_TYPE = 'day1_return';

const DAY1_RETURN_TEST_TASK_TYPE = 'day1_return_test';

const DAY1_RETURN_SCHEDULE_KEY = 'once';

const DAY1_RETURN_IDLE_HOURS = 22;

const DAY1_RETURN_SCAN_LIMIT = 500;

const DAY1_RETURN_MESSAGE_MAX_LEN = 180;

const DAY1_RETURN_MESSAGE_MAX_SENTENCES = 2;

function resolveDay1ReturnTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? DAY1_RETURN_TEST_TASK_TYPE : DAY1_RETURN_TASK_TYPE;
}

const DAY1_RETURN_DEFAULT_LOCALE = {
  text_variants: [
    'Ready for a 2-minute practice? Write one short sentence.',
    'Want to do a quick practice? Write one short sentence.'
  ],
  voice_variants: [
    'Ready for a quick practice? Send a short voice note.',
    'Want to get back into practice? Send a short voice note.'
  ],
};

function normalizeDay1ReturnVariantArray(raw, fallback) {
  const next = Array.isArray(raw)
    ? raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return next.length ? next : fallback.slice();
}

function resolveDay1ReturnLocale(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  const notifications = locale.notifications && typeof locale.notifications === 'object' ? locale.notifications : {};
  const raw = notifications.day1_return && typeof notifications.day1_return === 'object'
    ? notifications.day1_return
    : {};

  return {
    text_variants: normalizeDay1ReturnVariantArray(raw.text_variants, DAY1_RETURN_DEFAULT_LOCALE.text_variants),
    voice_variants: normalizeDay1ReturnVariantArray(raw.voice_variants, DAY1_RETURN_DEFAULT_LOCALE.voice_variants),
  };
}

async function scanEligibleDay1ReturnUsers() {
  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const { rows } = await pool.query(
    `SELECT
       ub.chat_id,
       ub.bot_key
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     JOIN bot_onboarding_completion onboarding
       ON onboarding.chat_id = ub.chat_id
      AND onboarding.bot_key = ub.bot_key
     WHERE COALESCE(ub.is_active, true) = true
       AND u.inactive_reason IS NULL
       AND onboarding.completed_at <= NOW() - ($1::int * interval '1 hour')
       AND COALESCE(ub.last_seen_at, onboarding.completed_at) <= onboarding.completed_at
       AND ($3::bigint[] IS NULL OR ub.chat_id = ANY($3::bigint[]))
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $2
           AND std.schedule_key = 'once'
           AND std.bot_key = ub.bot_key
           AND std.chat_id = ub.chat_id
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
     ORDER BY onboarding.completed_at ASC, ub.chat_id ASC, ub.bot_key ASC
     LIMIT $4::int`,
    [
      DAY1_RETURN_IDLE_HOURS,
      DAY1_RETURN_TASK_TYPE,
      testChatIds,
      DAY1_RETURN_SCAN_LIMIT
    ]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key),
    scheduleKey: DAY1_RETURN_SCHEDULE_KEY,
    taskType: DAY1_RETURN_TASK_TYPE
  })).filter((row) => Number.isFinite(row.chatId) && row.chatId > 0 && row.botKey);
}

async function loadDay1ReturnContext(chatId, botKeyRaw, { origin = WINBACK_AUTOMATED_ORIGIN } = {}) {
  const botKey = normalizeBotKey(botKeyRaw);
  const normalizedChatId = Number(chatId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !botKey) return null;

  const { rows } = await pool.query(
    `SELECT
       u.chat_id,
       u.first_name,
       u.inactive_reason,
       ub.bot_key,
       COALESCE(ub.is_active, true) AS is_active,
       ub.reply_mode,
       ub.last_seen_at,
       onboarding.completed_at AS onboarding_sent_at
     FROM users u
     JOIN user_bots ub
       ON ub.chat_id = u.chat_id
     LEFT JOIN bot_onboarding_completion onboarding
       ON onboarding.chat_id = ub.chat_id
      AND onboarding.bot_key = ub.bot_key
     WHERE u.chat_id = $1::bigint
       AND ub.bot_key = $2::text
     LIMIT 1`,
    [
      normalizedChatId,
      botKey
    ]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    chatId: normalizedChatId,
    botKey,
    firstName: normalizeOptionalText(row.first_name, 80) || '',
    inactiveReason: normalizeOptionalText(row.inactive_reason, 80),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    replyMode: normalizeReplyMode(row.reply_mode),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    onboardingSentAt: origin === WINBACK_ADMIN_TEST_ORIGIN
      ? (row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null)
      : (row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null),
    locale: resolveDay1ReturnLocale(botKey)
  };
}

function pickDay1ReturnVariants(context) {
  return context.replyMode === WINBACK_REPLY_MODE_VOICE
    ? context.locale.voice_variants
    : context.locale.text_variants;
}

function validateDay1ReturnMessageText(messageText) {
  const value = String(messageText ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'empty_message_text' };
  if (value.length > DAY1_RETURN_MESSAGE_MAX_LEN) return { ok: false, error: 'message_too_long' };
  if (countSentences(value) > DAY1_RETURN_MESSAGE_MAX_SENTENCES) return { ok: false, error: 'too_many_sentences' };
  if (countEmoji(value) > 1) return { ok: false, error: 'too_many_emoji' };
  if (containsHtmlLikeTags(value)) return { ok: false, error: 'html_not_allowed' };
  if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(value)) return { ok: false, error: 'unresolved_placeholder' };
  return { ok: true, messageText: value };
}

function buildDay1ReturnMessage(context, taskType) {
  const safeVariants = pickDay1ReturnVariants(context).filter(Boolean);
  if (safeVariants.length === 0) {
    return { ok: false, error: 'missing_day1_return_templates' };
  }

  const variantIndex = stableVariantIndex(
    `${context.chatId}:${context.botKey}:${taskType}:${context.replyMode}`,
    safeVariants.length
  );
  const template = safeVariants[variantIndex] || safeVariants[0];
  const messageText = applyTemplateSlots(template, {
    first_name: context.firstName,
  }).replace(/\s+/g, ' ').trim();
  const validation = validateDay1ReturnMessageText(messageText);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return {
    ok: true,
    messageText: validation.messageText,
    variantIndex,
    variantFamily: context.replyMode === WINBACK_REPLY_MODE_VOICE ? 'voice_variants' : 'text_variants'
  };
}

async function evaluateDay1ReturnEligibility({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN
}) {
  if (!isAutomatedMessageTestChatAllowed(chatId)) {
    throw createAppError('chat_not_allowed_in_test_mode', 403, 'chat_not_allowed_in_test_mode', { retryable: false });
  }

  const context = await loadDay1ReturnContext(chatId, botKey, { origin });
  if (!context) {
    if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
      throw createAppError('user_bot_not_found', 404, 'user_bot_not_found', { retryable: false });
    }
    return { ok: false, code: 'user_bot_not_found', context: null };
  }

  if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
    return { ok: true, code: null, context };
  }

  if (!context.isActive) return { ok: false, code: 'user_bot_inactive', context };
  if (context.inactiveReason) return { ok: false, code: 'permanent_telegram_inactive', context };
  if (!(context.onboardingSentAt instanceof Date) || !Number.isFinite(context.onboardingSentAt.getTime())) {
    return { ok: false, code: 'onboarding_not_sent', context };
  }

  if (context.onboardingSentAt.getTime() > Date.now() - (DAY1_RETURN_IDLE_HOURS * 60 * 60 * 1000)) {
    return { ok: false, code: 'outside_inactivity_window', context };
  }

  if (
    context.lastSeenAt instanceof Date
    && Number.isFinite(context.lastSeenAt.getTime())
    && context.lastSeenAt.getTime() > context.onboardingSentAt.getTime() + 1000
  ) {
    return { ok: false, code: 'user_active_after_onboarding', context };
  }

  if (await hasSentScheduledDispatch(DAY1_RETURN_TASK_TYPE, context.chatId, context.botKey, DAY1_RETURN_SCHEDULE_KEY)) {
    return { ok: false, code: 'already_sent', context };
  }

  const suppression = await hasRecentAutomatedBehavioralSuppression(context.chatId);
  if (suppression.suppressed) {
    return { ok: false, code: suppression.code, context };
  }

  return { ok: true, code: null, context };
}

export async function sendDay1ReturnReminderCore({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  taskType = resolveDay1ReturnTaskType(origin),
  scheduleKey = null
} = {}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (String(scheduleKey || '').trim() || buildManualTestScheduleKey())
    : DAY1_RETURN_SCHEDULE_KEY;

  const eligibility = await evaluateDay1ReturnEligibility({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    origin
  });

  if (!eligibility.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      origin,
      reminder_type: DAY1_RETURN_TASK_TYPE
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: eligibility.code,
      payloadJson: {
        origin,
        reminder_type: DAY1_RETURN_TASK_TYPE,
        skipped_reason: eligibility.code
      }
    });
    return null;
  }

  const context = eligibility.context;
  const message = buildDay1ReturnMessage(context, taskType);
  if (!message.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      origin,
      reminder_type: DAY1_RETURN_TASK_TYPE
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: message.error,
      payloadJson: {
        origin,
        reminder_type: DAY1_RETURN_TASK_TYPE,
        generation_error: message.error
      }
    });
    throw createAppError('day1_return_build_failed', 502, message.error, { retryable: false });
  }

  await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
    origin,
    reminder_type: DAY1_RETURN_TASK_TYPE
  });

  try {
    const telegramResult = await sendTelegramTextMessage(normalizedChatId, message.messageText, {
      botKey: normalizedBotKey
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;

    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'sent',
      telegramMessageId,
      payloadJson: {
        origin,
        reminder_type: DAY1_RETURN_TASK_TYPE,
        onboarding_sent_at: context.onboardingSentAt ? context.onboardingSentAt.toISOString() : null,
        message_text: message.messageText,
        variant_family: message.variantFamily,
        variant_index: message.variantIndex
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
      messageText: message.messageText,
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
        reminder_type: DAY1_RETURN_TASK_TYPE,
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

export async function sendAdminTestDay1ReturnReminder({ chatId, botKey }) {
  const result = await sendDay1ReturnReminderCore({
    chatId,
    botKey,
    origin: WINBACK_ADMIN_TEST_ORIGIN,
    taskType: resolveDay1ReturnTaskType(WINBACK_ADMIN_TEST_ORIGIN),
    scheduleKey: buildManualTestScheduleKey()
  });

  if (!result) {
    throw createAppError('day1_return_send_failed', 502, 'day1_return_send_failed', { retryable: false });
  }

  return {
    ok: true,
    chat_id: result.chatId,
    bot_key: result.botKey,
    reminder_type: DAY1_RETURN_TASK_TYPE,
    telegram_message_id: result.telegramMessageId,
    message_text: result.messageText,
    allowlist_active: result.allowlistActive,
    task_type: result.taskType,
    schedule_key: result.scheduleKey
  };
}

async function enqueueDay1ReturnSend(
  boss,
  { chatId, botKey, scheduleKey = DAY1_RETURN_SCHEDULE_KEY, taskType = DAY1_RETURN_TASK_TYPE }
) {
  return boss.send(
    QUEUE_DAY1_RETURN_SEND,
    { chatId, botKey, scheduleKey, taskType },
    {
      ...defaultRetryOptions(),
      singletonKey: `day1_return:${taskType}:${botKey}:${chatId}:${scheduleKey}`
    }
  );
}

export async function handleDay1ReturnScan(jobs, boss) {
  for (const job of jobs) {
    const eligibleUsers = await scanEligibleDay1ReturnUsers();
    console.log('day1-return-scan', {
      jobId: job.id,
      eligibleCount: eligibleUsers.length
    });

    for (const user of eligibleUsers) {
      await enqueueDay1ReturnSend(boss, user);
    }
  }
}

export async function handleDay1ReturnSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const taskType = String(job.data?.taskType || '').trim() || DAY1_RETURN_TASK_TYPE;
    const scheduleKey = String(job.data?.scheduleKey || '').trim() || DAY1_RETURN_SCHEDULE_KEY;
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) {
      continue;
    }

    try {
      const result = await sendDay1ReturnReminderCore({
        chatId,
        botKey,
        origin: WINBACK_AUTOMATED_ORIGIN,
        taskType,
        scheduleKey
      });

      if (!result) {
        console.log('day1-return-send:skipped', {
          jobId: job.id,
          chatId,
          botKey,
          scheduleKey
        });
        continue;
      }

      console.log('day1-return-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        taskType,
        telegramMessageId: result.telegramMessageId
      });
    } catch (error) {
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);
      const detail = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'day1_return_send_failed';

      console.warn('day1-return-send:failed', {
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
