import {
  WINBACK_AUTOMATED_ORIGIN,
  WINBACK_ADMIN_TEST_ORIGIN,
  automatedMessageTestChatIdsSqlParam,
  buildManualTestScheduleKey,
  isAutomatedMessageTestChatAllowed,
  hasRecentAutomatedBehavioralSuppression,
  getAutomatedMessageTestState
} from './policy.js';
import { getBotLocale, publicBotMetaForKey } from './bot-context.js';
import { pool } from '../db.js';
import { normalizeBotKey, normalizeOptionalText, clampInteger } from '../shared/normalization.js';
import {
  normalizeReplyMode,
  resolveTargetLanguageLabel,
  languageLabelForCode,
  resolveReplyCtaLabel,
  countSentences,
  countEmoji,
  containsHtmlLikeTags,
  stableVariantIndex,
  applyTemplateSlots,
  requestReminderResponse
} from './messages.js';
import { captureMessage } from '../sentry.js';
import { env } from '../env.js';
import { createAppError } from '../core/errors.js';
import { renderLlmPrompt } from '../ai/prompts/index.js';
import { createNotificationGraph } from '../ai/graphs/notifications.js';
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
import { QUEUE_WEEKLY_DIGEST_SEND, defaultRetryOptions } from '../queue.js';

const WEEKLY_DIGEST_TASK_TYPE = 'weekly_digest';

const WEEKLY_DIGEST_TEST_TASK_TYPE = 'weekly_digest_test';

const WEEKLY_DIGEST_SCAN_LIMIT = 500;

const WEEKLY_DIGEST_MESSAGE_MAX_LEN = 220;

const WEEKLY_DIGEST_MESSAGE_MAX_SENTENCES = 2;

const WEEKLY_DIGEST_MIN_PRACTICE_DAYS = 2;

const WEEKLY_DIGEST_RECENT_ACTIVITY_HOURS = 8;

const WEEKLY_DIGEST_SCAN_WEEKDAY = 1;

const WEEKLY_DIGEST_SCAN_HOUR_UTC = 16;

function resolveWeeklyDigestTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? WEEKLY_DIGEST_TEST_TASK_TYPE : WEEKLY_DIGEST_TASK_TYPE;
}

function addUtcDays(dateLike, days) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

function startOfUtcIsoWeek(dateLike) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - (day - 1));
  return start;
}

function buildIsoWeekParts(dateLike) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;

  const day = date.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + (4 - day));
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return { isoYear, isoWeek: week };
}

function buildWeeklyDigestScheduleKey(dateLike) {
  const parts = buildIsoWeekParts(dateLike);
  if (!parts) return null;
  return `${parts.isoYear}-W${String(parts.isoWeek).padStart(2, '0')}`;
}

function currentWeeklyDigestWindow(now = new Date()) {
  const currentWeekStart = startOfUtcIsoWeek(now);
  if (!(currentWeekStart instanceof Date) || !Number.isFinite(currentWeekStart.getTime())) return null;

  const weekStart = addUtcDays(currentWeekStart, -7);
  const weekEnd = currentWeekStart;
  const scheduleKey = buildWeeklyDigestScheduleKey(weekStart);
  if (!(weekStart instanceof Date) || !(weekEnd instanceof Date) || !scheduleKey) return null;

  return { weekStart, weekEnd, scheduleKey };
}

function isWeeklyDigestScanWindow(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return false;
  const weekday = date.getUTCDay() || 7;
  return weekday === WEEKLY_DIGEST_SCAN_WEEKDAY && date.getUTCHours() === WEEKLY_DIGEST_SCAN_HOUR_UTC;
}

const WEEKLY_DIGEST_DEFAULT_LOCALE = {
  reply_cta_voice: 'send a short voice note',
  reply_cta_text: 'write one short sentence',
  default_variants: [
    'Last week: {{practice_days}} practice days. {{reply_cta_label}} and let’s keep it going.',
    'You practised on {{practice_days}} days last week. {{reply_cta_label}} for a quick next step.'
  ],
};

function normalizeWeeklyDigestVariantArray(raw, fallback) {
  const next = Array.isArray(raw)
    ? raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return next.length ? next : fallback.slice();
}

function resolveWeeklyDigestLocale(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  const notifications = locale.notifications && typeof locale.notifications === 'object' ? locale.notifications : {};
  const raw = notifications.weekly_digest && typeof notifications.weekly_digest === 'object'
    ? notifications.weekly_digest
    : {};

  return {
    reply_cta_voice: String(raw.reply_cta_voice || WEEKLY_DIGEST_DEFAULT_LOCALE.reply_cta_voice).trim()
      || WEEKLY_DIGEST_DEFAULT_LOCALE.reply_cta_voice,
    reply_cta_text: String(raw.reply_cta_text || WEEKLY_DIGEST_DEFAULT_LOCALE.reply_cta_text).trim()
      || WEEKLY_DIGEST_DEFAULT_LOCALE.reply_cta_text,
    default_variants: normalizeWeeklyDigestVariantArray(raw.default_variants, WEEKLY_DIGEST_DEFAULT_LOCALE.default_variants),
  };
}

async function scanEligibleWeeklyDigestUsers(now = new Date()) {
  if (!isWeeklyDigestScanWindow(now)) {
    return [];
  }

  const window = currentWeeklyDigestWindow(now);
  if (!window) {
    return [];
  }

  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const { rows } = await pool.query(
    `SELECT
       ub.chat_id,
       ub.bot_key
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     JOIN LATERAL (
       SELECT
         COUNT(DISTINCT ((e.created_at AT TIME ZONE 'UTC')::date))::int AS practice_days
       FROM messages e
       WHERE e.role = 'user'
         AND e.chat_id = ub.chat_id
         AND e.bot_key = ub.bot_key
         AND e.created_at >= $1::timestamptz
         AND e.created_at < $2::timestamptz
     ) week_stats ON true
     WHERE COALESCE(ub.is_active, true) = true
       AND u.inactive_reason IS NULL
       AND ub.last_seen_at >= NOW() - interval '7 days'
       AND ub.last_seen_at <= NOW() - ($4::int * interval '1 hour')
       AND week_stats.practice_days >= $3::int
       AND ($6::bigint[] IS NULL OR ub.chat_id = ANY($6::bigint[]))
       AND EXISTS (
         SELECT 1
         FROM bot_onboarding_completion onboarding
         WHERE onboarding.bot_key = ub.bot_key
           AND onboarding.chat_id = ub.chat_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $5::text
           AND std.schedule_key = $7::text
           AND std.bot_key = ub.bot_key
           AND std.chat_id = ub.chat_id
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
     ORDER BY ub.last_seen_at DESC, ub.chat_id ASC, ub.bot_key ASC
     LIMIT $8::int`,
    [
      window.weekStart.toISOString(),
      window.weekEnd.toISOString(),
      WEEKLY_DIGEST_MIN_PRACTICE_DAYS,
      WEEKLY_DIGEST_RECENT_ACTIVITY_HOURS,
      WEEKLY_DIGEST_TASK_TYPE,
      testChatIds,
      window.scheduleKey,
      WEEKLY_DIGEST_SCAN_LIMIT
    ]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key),
    scheduleKey: window.scheduleKey,
    taskType: WEEKLY_DIGEST_TASK_TYPE
  })).filter((row) => Number.isFinite(row.chatId) && row.chatId > 0 && row.botKey && row.scheduleKey);
}

async function loadWeeklyDigestContext(chatId, botKeyRaw, {
  scheduleKey = null,
  origin = WINBACK_AUTOMATED_ORIGIN,
  now = new Date()
} = {}) {
  const botKey = normalizeBotKey(botKeyRaw);
  const normalizedChatId = Number(chatId);
  const window = currentWeeklyDigestWindow(now);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !botKey || !window) return null;

  const { rows } = await pool.query(
    `SELECT
       u.chat_id,
       u.first_name,
       u.username,
       u.inactive_reason,
       ub.bot_key,
       COALESCE(ub.is_active, true) AS is_active,
       ub.level,
       ub.reply_mode,
       ub.last_seen_at,
       COALESCE(us.profile_summary, '') AS profile_summary,
       COALESCE(us.short_summary, '') AS short_summary,
       onboarding.completed_at AS onboarding_sent_at,
       COALESCE(week_stats.practice_days, 0)::int AS practice_days
     FROM users u
     JOIN user_bots ub
       ON ub.chat_id = u.chat_id
     LEFT JOIN user_summaries us
       ON us.chat_id = ub.chat_id
      AND us.bot_key = ub.bot_key
     LEFT JOIN bot_onboarding_completion onboarding
       ON onboarding.chat_id = ub.chat_id
      AND onboarding.bot_key = ub.bot_key
     LEFT JOIN LATERAL (
       SELECT
         COUNT(DISTINCT ((e.created_at AT TIME ZONE 'UTC')::date))::int AS practice_days
       FROM messages e
       WHERE e.role = 'user'
         AND e.chat_id = ub.chat_id
         AND e.bot_key = ub.bot_key
         AND e.created_at >= $3::timestamptz
         AND e.created_at < $4::timestamptz
     ) week_stats ON true
     WHERE u.chat_id = $1::bigint
       AND ub.bot_key = $2::text
     LIMIT 1`,
    [
      normalizedChatId,
      botKey,
      window.weekStart.toISOString(),
      window.weekEnd.toISOString()
    ]
  );

  const row = rows[0];
  if (!row) return null;

  const locale = getBotLocale(botKey);
  const weeklyDigestLocale = resolveWeeklyDigestLocale(botKey);
  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (String(scheduleKey || '').trim() || buildManualTestScheduleKey())
    : window.scheduleKey;

  return {
    chatId: normalizedChatId,
    botKey,
    firstName: normalizeOptionalText(row.first_name, 80) || '',
    username: normalizeOptionalText(row.username, 80) || '',
    inactiveReason: normalizeOptionalText(row.inactive_reason, 80),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    level: normalizeOptionalText(row.level, 16) || 'a1',
    replyMode: normalizeReplyMode(row.reply_mode),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    onboardingSentAt: row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null,
    profileSummary: normalizeOptionalText(row.profile_summary, 2000) || '',
    shortSummary: normalizeOptionalText(row.short_summary, 1200) || '',
    practiceDays: clampInteger(row.practice_days, { min: 0, max: 7, fallback: 0 }),
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    digestScheduleKey: window.scheduleKey,
    scheduleKey: effectiveScheduleKey,
    locale,
    weeklyDigestLocale,
    targetLanguageLabel: resolveTargetLanguageLabel(botKey, locale),
    baseLanguageLabel: languageLabelForCode(publicBotMetaForKey(botKey)?.base_language || normalizeBotKey(botKey)?.split('-')?.[0] || ''),
    replyCtaLabel: resolveReplyCtaLabel(row.reply_mode, weeklyDigestLocale)
  };
}

function pickWeeklyDigestFallbackFamily(context) {
  return { family: 'default_variants', variants: context.weeklyDigestLocale.default_variants };
}

function validateWeeklyDigestMessageText(messageText, context = {}) {
  const value = String(messageText ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'empty_message_text' };
  if (value.length > WEEKLY_DIGEST_MESSAGE_MAX_LEN) return { ok: false, error: 'message_too_long' };
  if (countSentences(value) > WEEKLY_DIGEST_MESSAGE_MAX_SENTENCES) return { ok: false, error: 'too_many_sentences' };
  if (countEmoji(value) > 1) return { ok: false, error: 'too_many_emoji' };
  if (containsHtmlLikeTags(value)) return { ok: false, error: 'html_not_allowed' };
  if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(value)) return { ok: false, error: 'unresolved_placeholder' };
  if (/\b(plan|subscription|billing|upgrade)\b/i.test(value)) return { ok: false, error: 'billing_language_not_allowed' };
  if (/\bwe miss you\b/i.test(value) || /\bcome back now\b/i.test(value)) return { ok: false, error: 'spammy_phrase_not_allowed' };
  if (Number.isFinite(Number(context.practiceDays)) && !value.includes(String(context.practiceDays))) {
    return { ok: false, error: 'missing_practice_days_stat' };
  }
  return { ok: true, messageText: value };
}

function buildWeeklyDigestFallbackMessage(context, taskType) {
  const { family, variants } = pickWeeklyDigestFallbackFamily(context);
  const safeVariants = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (safeVariants.length === 0) {
    return { ok: false, error: 'missing_weekly_digest_templates' };
  }

  const variantIndex = stableVariantIndex(
    `${context.chatId}:${context.botKey}:${context.digestScheduleKey}:${taskType}:${family}`,
    safeVariants.length
  );
  const template = safeVariants[variantIndex] || safeVariants[0];
  const messageText = applyTemplateSlots(template, {
    first_name: context.firstName,
    practice_days: context.practiceDays,
    reply_cta_label: context.replyCtaLabel
  }).replace(/\s+/g, ' ').trim();
  return {
    ok: true,
    messageText,
    source: 'fallback_template',
    templateFamily: family,
    variantIndex
  };
}

function reportWeeklyDigestFallback(context, generationError, fallback, origin) {
  captureMessage('weekly_digest_llm_fallback', {
    tags: {
      subsystem: 'weekly-digest',
      reminder_type: WEEKLY_DIGEST_TASK_TYPE,
      origin: String(origin || '').trim() || WINBACK_AUTOMATED_ORIGIN,
      bot_key: context?.botKey || '',
      template_family: fallback?.templateFamily || '',
      generation_error: generationError || 'unknown'
    },
    extra: {
      chat_id: context?.chatId || null,
      schedule_key: context?.scheduleKey || null,
      digest_schedule_key: context?.digestScheduleKey || null,
      practice_days: context?.practiceDays ?? null,
      reply_mode: context?.replyMode || null,
      fallback_message_text: fallback?.messageText || null
    },
    level: 'warning'
  });
}

async function generateWeeklyDigestMessageWithLlm(context, taskType) {
  if (!env.openaiApiKey) {
    throw createAppError('missing_openai_api_key', 502, 'missing_openai_api_key', { retryable: false });
  }

  const systemPrompt = renderLlmPrompt('notifications/weekly-digest-system', {
    base_language_label: context.baseLanguageLabel,
    target_language_label: context.targetLanguageLabel,
    message_max_len: WEEKLY_DIGEST_MESSAGE_MAX_LEN,
    message_max_sentences: WEEKLY_DIGEST_MESSAGE_MAX_SENTENCES
  });

  const payload = {
    reminder_type: WEEKLY_DIGEST_TASK_TYPE,
    bot_key: context.botKey,
    week: {
      schedule_key: context.digestScheduleKey,
      start_utc: context.weekStart?.toISOString?.() || null,
      end_utc: context.weekEnd?.toISOString?.() || null
    },
    user: {
      first_name: context.firstName || null,
      level: context.level,
      reply_mode: context.replyMode,
      profile_summary: context.profileSummary || null,
      short_summary: context.shortSummary || null
    },
    progress: {
      practice_days: context.practiceDays
    },
    cta: {
      label: context.replyCtaLabel
    }
  };
  const userPrompt = renderLlmPrompt('notifications/weekly-digest-user', {
    context_json: JSON.stringify(payload, null, 2)
  });

  const payloadJson = await requestReminderResponse({
    context,
    operation: 'reminder.weekly_digest',
    system: systemPrompt,
    user: userPrompt,
    name: 'weekly_digest_message',
    schema: {
      type: 'object',
      properties: {
        message_text: { type: 'string', minLength: 1, maxLength: WEEKLY_DIGEST_MESSAGE_MAX_LEN }
      },
      required: ['message_text'],
      additionalProperties: false
    }
  });

  const parsed = payloadJson.value;

  return {
    messageText: String(parsed?.message_text || '').trim(),
    source: 'llm',
    outputSource: 'output_content.output_text',
    model: String(payloadJson?.model || env.reminderLlmModel || '').trim() || env.reminderLlmModel,
    responseId: payloadJson.responseId,
    usage: payloadJson?.usage || null,
    taskType
  };
}

const weeklyDigestGraph = createNotificationGraph({
  generate: generateWeeklyDigestMessageWithLlm,
  validate: validateWeeklyDigestMessageText,
  fallback: buildWeeklyDigestFallbackMessage
});

async function evaluateWeeklyDigestEligibility({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  scheduleKey = null,
  now = new Date()
}) {
  if (!isAutomatedMessageTestChatAllowed(chatId)) {
    throw createAppError('chat_not_allowed_in_test_mode', 403, 'chat_not_allowed_in_test_mode', { retryable: false });
  }

  const window = currentWeeklyDigestWindow(now);
  if (!window) {
    return { ok: false, code: 'weekly_window_unavailable', context: null };
  }

  const context = await loadWeeklyDigestContext(chatId, botKey, { scheduleKey, origin, now });
  if (!context) {
    if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
      throw createAppError('user_bot_not_found', 404, 'user_bot_not_found', { retryable: false });
    }
    return { ok: false, code: 'user_bot_not_found', context: null };
  }

  if (origin === WINBACK_ADMIN_TEST_ORIGIN) {
    return { ok: true, code: null, context };
  }

  if (scheduleKey && scheduleKey !== window.scheduleKey) {
    return { ok: false, code: 'weekly_window_changed', context };
  }
  if (!context.isActive) return { ok: false, code: 'user_bot_inactive', context };
  if (context.inactiveReason) return { ok: false, code: 'permanent_telegram_inactive', context };
  if (!(context.onboardingSentAt instanceof Date) || !Number.isFinite(context.onboardingSentAt.getTime())) {
    return { ok: false, code: 'onboarding_not_sent', context };
  }
  if (!(context.lastSeenAt instanceof Date) || !Number.isFinite(context.lastSeenAt.getTime())) {
    return { ok: false, code: 'missing_last_seen_at', context };
  }
  if (context.lastSeenAt.getTime() < Date.now() - (7 * 24 * 60 * 60 * 1000)) {
    return { ok: false, code: 'not_active_in_last_7_days', context };
  }
  if (context.lastSeenAt.getTime() > Date.now() - (WEEKLY_DIGEST_RECENT_ACTIVITY_HOURS * 60 * 60 * 1000)) {
    return { ok: false, code: 'recent_user_activity', context };
  }
  if (context.practiceDays < WEEKLY_DIGEST_MIN_PRACTICE_DAYS) {
    return { ok: false, code: 'insufficient_practice_days', context };
  }
  if (await hasSentScheduledDispatch(WEEKLY_DIGEST_TASK_TYPE, context.chatId, context.botKey, context.digestScheduleKey)) {
    return { ok: false, code: 'already_sent', context };
  }

  const suppression = await hasRecentAutomatedBehavioralSuppression(context.chatId);
  if (suppression.suppressed) {
    return { ok: false, code: suppression.code, context };
  }

  return { ok: true, code: null, context };
}

export async function sendWeeklyDigestReminderCore({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  taskType = resolveWeeklyDigestTaskType(origin),
  scheduleKey = null,
  now = new Date()
} = {}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const window = currentWeeklyDigestWindow(now);
  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (String(scheduleKey || '').trim() || buildManualTestScheduleKey())
    : (window?.scheduleKey || String(scheduleKey || '').trim());

  const eligibility = await evaluateWeeklyDigestEligibility({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    origin,
    scheduleKey: effectiveScheduleKey,
    now
  });

  if (!eligibility.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      origin,
      reminder_type: WEEKLY_DIGEST_TASK_TYPE
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: eligibility.code,
      payloadJson: {
        origin,
        reminder_type: WEEKLY_DIGEST_TASK_TYPE,
        skipped_reason: eligibility.code
      }
    });
    return null;
  }

  const context = eligibility.context;
  await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
    origin,
    reminder_type: WEEKLY_DIGEST_TASK_TYPE,
    digest_schedule_key: context.digestScheduleKey
  });

  const { generation, generationError, fallbackError } = await weeklyDigestGraph.invoke(
    { usesLlm: true, generationError: null, fallbackError: null, failure: null },
    { context: { notification: context, taskType } }
  );
  if (!generation) {
    const error = generationError || fallbackError || 'weekly_digest_build_failed';
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: error,
      payloadJson: { origin, reminder_type: WEEKLY_DIGEST_TASK_TYPE, generation_error: error }
    });
    throw createAppError('weekly_digest_build_failed', 502, error, { retryable: false });
  }
  if (generation.source !== 'llm') {
    reportWeeklyDigestFallback(context, generationError, generation, origin);
  }

  try {
    const telegramResult = await sendTelegramTextMessage(normalizedChatId, generation.messageText, {
      botKey: normalizedBotKey
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;

    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'sent',
      telegramMessageId,
      payloadJson: {
        origin,
        reminder_type: WEEKLY_DIGEST_TASK_TYPE,
        digest_schedule_key: context.digestScheduleKey,
        week_start_utc: context.weekStart ? context.weekStart.toISOString() : null,
        week_end_utc: context.weekEnd ? context.weekEnd.toISOString() : null,
        practice_days: context.practiceDays,
        message_source: generation.source,
        generation_error: generation.source === 'llm' ? null : (generationError || null),
        template_family: generation.templateFamily || null,
        variant_index: Number.isInteger(generation.variantIndex) ? generation.variantIndex : null,
        llm_model: generation.model || null,
        llm_response_id: generation.responseId || null,
        llm_output_source: generation.outputSource || null,
        message_text: generation.messageText
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
      digestScheduleKey: context.digestScheduleKey,
      telegramMessageId,
      messageText: generation.messageText,
      messageSource: generation.source,
      generationError: generation.source === 'llm' ? null : (generationError || null),
      llmResponseId: generation.responseId || null,
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
        reminder_type: WEEKLY_DIGEST_TASK_TYPE,
        generation_error: generationError,
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

export async function sendAdminTestWeeklyDigestReminder({ chatId, botKey }) {
  const result = await sendWeeklyDigestReminderCore({
    chatId,
    botKey,
    origin: WINBACK_ADMIN_TEST_ORIGIN,
    taskType: resolveWeeklyDigestTaskType(WINBACK_ADMIN_TEST_ORIGIN),
    scheduleKey: buildManualTestScheduleKey()
  });

  if (!result) {
    throw createAppError('weekly_digest_send_failed', 502, 'weekly_digest_send_failed', { retryable: false });
  }

  return {
    ok: true,
    chat_id: result.chatId,
    bot_key: result.botKey,
    reminder_type: WEEKLY_DIGEST_TASK_TYPE,
    telegram_message_id: result.telegramMessageId,
    message_text: result.messageText,
    message_source: result.messageSource || null,
    generation_error: result.generationError || null,
    llm_response_id: result.llmResponseId || null,
    allowlist_active: result.allowlistActive,
    task_type: result.taskType,
    schedule_key: result.scheduleKey,
    digest_schedule_key: result.digestScheduleKey
  };
}

async function enqueueWeeklyDigestSend(
  boss,
  { chatId, botKey, scheduleKey, taskType = WEEKLY_DIGEST_TASK_TYPE }
) {
  return boss.send(
    QUEUE_WEEKLY_DIGEST_SEND,
    { chatId, botKey, scheduleKey, taskType },
    {
      ...defaultRetryOptions(),
      singletonKey: `weekly_digest:${taskType}:${botKey}:${chatId}:${scheduleKey}`
    }
  );
}

export async function handleWeeklyDigestScan(jobs, boss) {
  for (const job of jobs) {
    const eligibleUsers = await scanEligibleWeeklyDigestUsers();
    console.log('weekly-digest-scan', {
      jobId: job.id,
      eligibleCount: eligibleUsers.length
    });

    for (const user of eligibleUsers) {
      await enqueueWeeklyDigestSend(boss, user);
    }
  }
}

export async function handleWeeklyDigestSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const taskType = String(job.data?.taskType || '').trim() || WEEKLY_DIGEST_TASK_TYPE;
    const scheduleKey = String(job.data?.scheduleKey || '').trim();
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !scheduleKey) {
      continue;
    }

    try {
      const result = await sendWeeklyDigestReminderCore({
        chatId,
        botKey,
        origin: WINBACK_AUTOMATED_ORIGIN,
        taskType,
        scheduleKey
      });

      if (!result) {
        console.log('weekly-digest-send:skipped', {
          jobId: job.id,
          chatId,
          botKey,
          scheduleKey
        });
        continue;
      }

      console.log('weekly-digest-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        taskType,
        digestScheduleKey: result.digestScheduleKey,
        telegramMessageId: result.telegramMessageId
      });
    } catch (error) {
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);
      const detail = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'weekly_digest_send_failed';

      console.warn('weekly-digest-send:failed', {
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
