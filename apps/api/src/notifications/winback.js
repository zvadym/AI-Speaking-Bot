import {
  WINBACK_AUTOMATED_ORIGIN,
  WINBACK_ADMIN_TEST_ORIGIN,
  automatedMessageTestChatIdsSqlParam,
  isAutomatedMessageTestChatAllowed,
  hasRecentAutomatedBehavioralSuppression,
  buildManualTestScheduleKey,
  getAutomatedMessageTestState
} from './policy.js';
import { getBotLocale, publicBotMetaForKey } from './bot-context.js';
import { pool } from '../db.js';
import { normalizeBotKey, normalizeOptionalText, clampInteger } from '../shared/normalization.js';
import {
  normalizeReplyMode,
  normalizeConversationText,
  resolveTargetLanguageLabel,
  languageLabelForCode,
  resolveReplyCtaLabel,
  WINBACK_REPLY_MODE_VOICE,
  stableVariantIndex,
  applyTemplateSlots,
  countSentences,
  countEmoji,
  containsHtmlLikeTags,
  requestReminderResponse
} from './messages.js';
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
import { QUEUE_WINBACK_SEND, defaultRetryOptions } from '../queue.js';

const WINBACK_SCAN_LIMIT = 500;

const WINBACK_MESSAGE_MAX_LEN = 220;

const WINBACK_MESSAGE_MAX_SENTENCES = 2;

const WINBACK_CONTEXT_TURN_LIMIT = 4;

const WINBACK_REMINDER_TYPES = new Set(['d3', 'd7', 'd14']);

const WINBACK_STAGE_CONFIG = {
  d3: {
    reminderType: 'd3',
    taskType: 'winback_d3',
    testTaskType: 'winback_d3_test',
    minHours: 72,
    maxHours: 96,
    usesLlm: true,
    persistToMessages: true
  },
  d7: {
    reminderType: 'd7',
    taskType: 'winback_d7',
    testTaskType: 'winback_d7_test',
    minHours: 168,
    maxHours: 192,
    usesLlm: true,
    persistToMessages: false
  },
  d14: {
    reminderType: 'd14',
    taskType: 'winback_d14',
    testTaskType: 'winback_d14_test',
    minHours: 336,
    maxHours: null,
    usesLlm: false,
    persistToMessages: false
  }
};

const WINBACK_STAGE_ORDER = ['d3', 'd7', 'd14'];

function parseWinbackReminderType(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  return WINBACK_REMINDER_TYPES.has(value) ? value : null;
}

function resolveWinbackStageConfig(reminderType) {
  const normalized = parseWinbackReminderType(reminderType);
  if (!normalized) return null;
  return WINBACK_STAGE_CONFIG[normalized] || null;
}

function resolveWinbackTaskType(reminderType, origin = WINBACK_AUTOMATED_ORIGIN) {
  const config = resolveWinbackStageConfig(reminderType);
  if (!config) return null;
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? config.testTaskType : config.taskType;
}

function buildWinbackScheduleKey(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;
  return `inactive_since:${date.toISOString()}`;
}

const WINBACK_DEFAULT_LOCALE = {
  reply_cta_voice: 'send a short voice message',
  reply_cta_text: 'write one short sentence',
  d3_fallback_variants: [
    'So, shall we continue? Write one short sentence — and then I will help.',
    'Ready to keep going? Write one short sentence — and then I will help.'
  ],
  d7_fallback_variants: [
    'Want to practice again? Write one short sentence — and I will pick it up from there.',
    'Want to get back to practice? Write one short sentence — and I will pick it up.'
  ],
  d14: {
    default: [
      'No pressure. We can restart from zero anytime. {{reply_cta_label}} when you want.',
      'Whenever you are ready, we can start fresh. {{reply_cta_label}}.'
    ],
    streak: [
      'You already built a {{streak_best}}-day streak once. We can start again with one small step. {{reply_cta_label}}.',
      'Your best streak was {{streak_best}} days. Restarting can be just one short message. {{reply_cta_label}}.'
    ],
    voice: [
      'A quick voice reply is enough to restart. {{reply_cta_label}} when you feel like it.',
      'We can make the comeback easy. {{reply_cta_label}} and we will go from there.'
    ]
  }
};

function normalizeWinbackVariantArray(raw, fallback) {
  const next = Array.isArray(raw)
    ? raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return next.length ? next : fallback.slice();
}

function resolveWinbackLocale(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  const notifications = locale.notifications && typeof locale.notifications === 'object' ? locale.notifications : {};
  const winback = notifications.winback && typeof notifications.winback === 'object' ? notifications.winback : {};
  const rawD14 = winback.d14 && typeof winback.d14 === 'object' ? winback.d14 : {};

  return {
    reply_cta_voice: String(winback.reply_cta_voice || WINBACK_DEFAULT_LOCALE.reply_cta_voice).trim() || WINBACK_DEFAULT_LOCALE.reply_cta_voice,
    reply_cta_text: String(winback.reply_cta_text || WINBACK_DEFAULT_LOCALE.reply_cta_text).trim() || WINBACK_DEFAULT_LOCALE.reply_cta_text,
    d3_fallback_variants: normalizeWinbackVariantArray(winback.d3_fallback_variants, WINBACK_DEFAULT_LOCALE.d3_fallback_variants),
    d7_fallback_variants: normalizeWinbackVariantArray(winback.d7_fallback_variants, WINBACK_DEFAULT_LOCALE.d7_fallback_variants),
    d14: {
      default: normalizeWinbackVariantArray(rawD14.default, WINBACK_DEFAULT_LOCALE.d14.default),
      streak: normalizeWinbackVariantArray(rawD14.streak, WINBACK_DEFAULT_LOCALE.d14.streak),
      voice: normalizeWinbackVariantArray(rawD14.voice, WINBACK_DEFAULT_LOCALE.d14.voice)
    }
  };
}

async function insertAssistantMessage(chatId, botKey, content) {
  const { rows } = await pool.query(
    `INSERT INTO messages (
       chat_id,
       role,
       content,
       bot_key
     )
     VALUES ($1::bigint, 'assistant', $2::text, $3::text)
     RETURNING id, created_at`,
    [chatId, String(content ?? '').trim(), botKey]
  );
  return rows[0] || null;
}

async function loadWinbackBaseState(chatId, botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!Number.isFinite(Number(chatId)) || Number(chatId) <= 0 || !botKey) return null;

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
       last_user.created_at AS last_user_message_at,
       last_user.content AS last_user_message_text,
       last_assistant.created_at AS last_assistant_message_at,
       last_assistant.content AS last_assistant_message_text
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     LEFT JOIN user_summaries us
       ON us.chat_id = ub.chat_id
      AND us.bot_key = ub.bot_key
     LEFT JOIN LATERAL (
       SELECT created_at, content
       FROM messages
       WHERE chat_id = ub.chat_id
         AND bot_key = ub.bot_key
         AND role = 'user'
         AND BTRIM(content) <> ''
       ORDER BY id DESC
       LIMIT 1
     ) last_user ON true
     LEFT JOIN LATERAL (
       SELECT created_at, content
       FROM messages
       WHERE chat_id = ub.chat_id
         AND bot_key = ub.bot_key
         AND role = 'assistant'
         AND BTRIM(content) <> ''
       ORDER BY id DESC
       LIMIT 1
     ) last_assistant ON true
     WHERE ub.chat_id = $1::bigint
       AND ub.bot_key = $2::text
     LIMIT 1`,
    [Number(chatId), botKey]
  );

  const row = rows[0];
  if (!row) return null;

  const lastUserMessageAt = row.last_user_message_at ? new Date(row.last_user_message_at) : null;
  const inactiveSinceAt = row.last_seen_at
    ? new Date(row.last_seen_at)
    : lastUserMessageAt;
  const inactivityHours = inactiveSinceAt ? (Date.now() - inactiveSinceAt.getTime()) / (60 * 60 * 1000) : null;
  const botMeta = publicBotMetaForKey(botKey) || {};

  return {
    chatId: Number(row.chat_id),
    botKey,
    firstName: normalizeOptionalText(row.first_name, 80) || '',
    username: normalizeOptionalText(row.username, 80) || '',
    inactiveReason: normalizeOptionalText(row.inactive_reason, 80),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    level: normalizeOptionalText(row.level, 16) || 'a1',
    replyMode: normalizeReplyMode(row.reply_mode),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    inactiveSinceAt,
    inactivityHours,
    profileSummary: normalizeOptionalText(row.profile_summary, 2000) || '',
    shortSummary: normalizeOptionalText(row.short_summary, 1200) || '',
    lastUserMessageAt,
    lastUserMessageText: normalizeConversationText(row.last_user_message_text, 320),
    lastAssistantMessageAt: row.last_assistant_message_at ? new Date(row.last_assistant_message_at) : null,
    lastAssistantMessageText: normalizeConversationText(row.last_assistant_message_text, 320),
    hasUserMessage: Boolean(row.last_user_message_at),
    hasAssistantMessage: Boolean(row.last_assistant_message_at),
    baseLanguage: botMeta.base_language || normalizeBotKey(botKey)?.split('-')?.[0] || '',
    targetLanguage: botMeta.learning_language || botMeta.target_lang || normalizeBotKey(botKey)?.split('-')?.[1] || ''
  };
}

async function loadWinbackRecentTurns(chatId, botKey, limit = WINBACK_CONTEXT_TURN_LIMIT) {
  const safeLimit = clampInteger(limit, { min: 1, max: 12, fallback: WINBACK_CONTEXT_TURN_LIMIT });
  const { rows } = await pool.query(
    `SELECT role, content, created_at
       FROM messages
      WHERE chat_id = $1::bigint
        AND bot_key = $2::text
        AND BTRIM(content) <> ''
      ORDER BY id DESC
      LIMIT $3::int`,
    [chatId, botKey, safeLimit]
  );

  return rows
    .slice()
    .reverse()
    .map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeConversationText(row.content, 320),
      created_at: row.created_at || null
    }))
    .filter((row) => row.content);
}

async function loadWinbackContext(chatId, botKey, reminderType, scheduleKey) {
  const baseState = await loadWinbackBaseState(chatId, botKey);
  if (!baseState) return null;

  const locale = getBotLocale(botKey);
  const winbackLocale = resolveWinbackLocale(botKey);
  const recentTurns = reminderType === 'd3'
    ? await loadWinbackRecentTurns(chatId, botKey, WINBACK_CONTEXT_TURN_LIMIT)
    : [];

  return {
    ...baseState,
    reminderType,
    scheduleKey,
    locale,
    winbackLocale,
    targetLanguageLabel: resolveTargetLanguageLabel(botKey, locale),
    baseLanguageLabel: languageLabelForCode(baseState.baseLanguage),
    replyCtaLabel: resolveReplyCtaLabel(baseState.replyMode, winbackLocale),
    inactivityDays: baseState.inactivityHours === null ? null : Math.max(0, Math.floor(baseState.inactivityHours / 24)),
    recentTurns
  };
}

async function scanEligibleWinbackUsers(reminderType) {
  const stageConfig = resolveWinbackStageConfig(reminderType);
  if (!stageConfig) return [];

  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const inactiveSinceSql = `COALESCE(ub.last_seen_at, last_user.created_at)`;
  const scheduleKeySql = `'inactive_since:' || to_char((${inactiveSinceSql}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const { rows } = await pool.query(
    `SELECT
       ub.chat_id,
       ub.bot_key,
       ${inactiveSinceSql} AS inactive_since_at,
       ${scheduleKeySql} AS schedule_key
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     JOIN LATERAL (
       SELECT created_at
       FROM messages
       WHERE chat_id = ub.chat_id
         AND bot_key = ub.bot_key
         AND role = 'user'
         AND BTRIM(content) <> ''
       ORDER BY id DESC
       LIMIT 1
     ) last_user ON true
     JOIN LATERAL (
       SELECT 1
       FROM messages
       WHERE chat_id = ub.chat_id
         AND bot_key = ub.bot_key
         AND role = 'assistant'
         AND BTRIM(content) <> ''
       LIMIT 1
     ) assistant_exists ON true
     WHERE COALESCE(ub.is_active, true) = true
       AND u.inactive_reason IS NULL
       AND ${inactiveSinceSql} IS NOT NULL
       AND last_user.created_at <= ${inactiveSinceSql}
       AND ($1::int IS NULL OR ${inactiveSinceSql} > NOW() - ($1::int * interval '1 hour'))
       AND ${inactiveSinceSql} <= NOW() - ($2::int * interval '1 hour')
       AND ($3::bigint[] IS NULL OR ub.chat_id = ANY($3::bigint[]))
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $4::text
           AND std.bot_key = ub.bot_key
           AND std.chat_id = ub.chat_id
           AND std.schedule_key = ${scheduleKeySql}
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
     ORDER BY ${inactiveSinceSql} ASC, ub.chat_id ASC, ub.bot_key ASC
     LIMIT $5::int`,
    [
      Number.isFinite(Number(stageConfig.maxHours)) ? Number(stageConfig.maxHours) : null,
      stageConfig.minHours,
      testChatIds,
      stageConfig.taskType,
      WINBACK_SCAN_LIMIT
    ]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key),
    scheduleKey: String(row.schedule_key || '').trim() || buildWinbackScheduleKey(row.inactive_since_at),
    inactiveSinceAt: row.inactive_since_at ? new Date(row.inactive_since_at) : null,
    reminderType: stageConfig.reminderType,
    taskType: stageConfig.taskType
  }));
}

function pickWinbackFallbackFamily(context) {
  if (context.reminderType === 'd3') return { family: 'd3_fallback_variants', variants: context.winbackLocale.d3_fallback_variants };
  if (context.reminderType === 'd7') return { family: 'd7_fallback_variants', variants: context.winbackLocale.d7_fallback_variants };

  if (context.replyMode === WINBACK_REPLY_MODE_VOICE) {
    return { family: 'd14.voice', variants: context.winbackLocale.d14.voice };
  }
  return { family: 'd14.default', variants: context.winbackLocale.d14.default };
}

function buildWinbackFallbackMessage(context, taskType) {
  const { family, variants } = pickWinbackFallbackFamily(context);
  const safeVariants = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (safeVariants.length === 0) {
    return {
      ok: false,
      error: 'missing_winback_templates'
    };
  }

  const variantIndex = stableVariantIndex(
    `${context.chatId}:${context.botKey}:${context.scheduleKey}:${taskType}`,
    safeVariants.length
  );
  const template = safeVariants[variantIndex] || safeVariants[0];
  const messageText = applyTemplateSlots(template, {
    first_name: context.firstName,
    target_language_label: context.targetLanguageLabel,
    reply_cta_label: context.replyCtaLabel
  }).replace(/\s+/g, ' ').trim();

  return {
    ok: Boolean(messageText),
    error: messageText ? null : 'empty_fallback_message',
    messageText,
    source: 'fallback_template',
    templateFamily: family,
    variantIndex
  };
}

function validateWinbackMessageText(messageText, context = {}) {
  const value = String(messageText ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'empty_message_text' };
  if (value.length > WINBACK_MESSAGE_MAX_LEN) return { ok: false, error: 'message_too_long' };
  if (countSentences(value) > WINBACK_MESSAGE_MAX_SENTENCES) return { ok: false, error: 'too_many_sentences' };
  if (countEmoji(value) > 1) return { ok: false, error: 'too_many_emoji' };
  if (containsHtmlLikeTags(value)) return { ok: false, error: 'html_not_allowed' };
  if (/we noticed you were inactive/i.test(value) || /noticed you were inactive/i.test(value)) {
    return { ok: false, error: 'inactive_phrase_not_allowed' };
  }
  if (/\b(plan|subscription|billing|upgrade)\b/i.test(value)) {
    return { ok: false, error: 'billing_language_not_allowed' };
  }

  const userText = normalizeConversationText(context.lastUserMessageText, 80).toLowerCase();
  if (userText.length >= 24 && value.toLowerCase().includes(userText.slice(0, Math.min(40, userText.length)))) {
    return { ok: false, error: 'quotes_user_history_too_directly' };
  }

  return { ok: true, messageText: value };
}

async function generateWinbackMessageWithLlm(context, taskType) {
  if (!env.openaiApiKey) {
    throw createAppError('missing_openai_api_key', 502, 'missing_openai_api_key', { retryable: false });
  }

  const reminderGoal = context.reminderType === 'd3'
    ? 'resume the practice naturally'
    : 'offer an easy restart, not a continuation';
  const systemPrompt = renderLlmPrompt('notifications/winback-system', {
    base_language_label: context.baseLanguageLabel,
    target_language_label: context.targetLanguageLabel,
    reminder_goal: reminderGoal,
    message_max_len: WINBACK_MESSAGE_MAX_LEN,
    message_max_sentences: WINBACK_MESSAGE_MAX_SENTENCES
  });

  const payload = {
    reminder_type: context.reminderType,
    goal: reminderGoal,
    bot_key: context.botKey,
    base_language: context.baseLanguage,
    target_language: context.targetLanguage,
    target_language_label: context.targetLanguageLabel,
    user: {
      first_name: context.firstName || null,
      level: context.level,
      reply_mode: context.replyMode,
      profile_summary: context.profileSummary || null,
      short_summary: context.shortSummary || null,
      inactivity_days: context.inactivityDays
    },
    conversation: {
      last_user_message: context.lastUserMessageText || null,
      last_assistant_message: context.lastAssistantMessageText || null,
      recent_turns: context.reminderType === 'd3' ? context.recentTurns : []
    }
  };
  const userPrompt = renderLlmPrompt('notifications/winback-user', {
    context_json: JSON.stringify(payload, null, 2)
  });

  const payloadJson = await requestReminderResponse({
    context,
    operation: 'reminder.winback',
    system: systemPrompt,
    user: userPrompt,
    name: 'winback_message',
    schema: {
      type: 'object',
      properties: {
        message_text: { type: 'string', minLength: 1, maxLength: WINBACK_MESSAGE_MAX_LEN }
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

const winbackGraph = createNotificationGraph({
  generate: generateWinbackMessageWithLlm,
  validate: validateWinbackMessageText,
  fallback: buildWinbackFallbackMessage
});

async function evaluateWinbackEligibility({
  chatId,
  botKey,
  reminderType,
  origin = WINBACK_AUTOMATED_ORIGIN,
  scheduleKey = null
}) {
  const stageConfig = resolveWinbackStageConfig(reminderType);
  if (!stageConfig) {
    throw createAppError('bad_reminder_type', 400, 'bad_reminder_type', { retryable: false });
  }

  if (!isAutomatedMessageTestChatAllowed(chatId)) {
    throw createAppError('chat_not_allowed_in_test_mode', 403, 'chat_not_allowed_in_test_mode', { retryable: false });
  }

  const context = await loadWinbackContext(chatId, botKey, reminderType, scheduleKey);
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
  if (!context.hasUserMessage || !context.hasAssistantMessage) return { ok: false, code: 'insufficient_message_history', context };
  if (!(context.inactiveSinceAt instanceof Date) || !Number.isFinite(context.inactiveSinceAt.getTime())) {
    return { ok: false, code: 'missing_inactive_since', context };
  }

  const currentScheduleKey = buildWinbackScheduleKey(context.inactiveSinceAt);
  if (!currentScheduleKey || (scheduleKey && currentScheduleKey !== scheduleKey)) {
    return { ok: false, code: 'inactivity_episode_changed', context };
  }

  if (context.lastUserMessageAt instanceof Date && context.lastUserMessageAt.getTime() > context.inactiveSinceAt.getTime() + 1000) {
    return { ok: false, code: 'new_user_activity_after_episode', context };
  }

  const inactivityHours = Number(context.inactivityHours);
  const hasUpperBound = Number.isFinite(Number(stageConfig.maxHours));
  if (
    !Number.isFinite(inactivityHours) ||
    inactivityHours < stageConfig.minHours ||
    (hasUpperBound && inactivityHours >= Number(stageConfig.maxHours))
  ) {
    return { ok: false, code: 'outside_inactivity_window', context };
  }

  if (await hasSentScheduledDispatch(stageConfig.taskType, context.chatId, context.botKey, currentScheduleKey)) {
    return { ok: false, code: 'already_sent', context };
  }

  const suppression = await hasRecentAutomatedBehavioralSuppression(context.chatId);
  if (suppression.suppressed) {
    return { ok: false, code: suppression.code, context };
  }

  context.scheduleKey = currentScheduleKey;
  return { ok: true, code: null, context };
}

async function sendWinbackReminderCore({
  chatId,
  botKey,
  reminderType,
  origin = WINBACK_AUTOMATED_ORIGIN,
  taskType = resolveWinbackTaskType(reminderType, origin),
  scheduleKey = null
} = {}) {
  const stageConfig = resolveWinbackStageConfig(reminderType);
  if (!stageConfig || !taskType) {
    throw createAppError('bad_reminder_type', 400, 'bad_reminder_type', { retryable: false });
  }

  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const initialScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (scheduleKey || buildManualTestScheduleKey())
    : (scheduleKey || null);

  const eligibility = await evaluateWinbackEligibility({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    reminderType,
    origin,
    scheduleKey: initialScheduleKey
  });

  if (!eligibility.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, initialScheduleKey, {
      origin,
      reminder_type: reminderType
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, initialScheduleKey, {
      status: 'failed',
      lastError: eligibility.code,
      payloadJson: {
        origin,
        reminder_type: reminderType,
        skipped_reason: eligibility.code
      }
    });
    return null;
  }

  const context = eligibility.context;
  const effectiveScheduleKey = context.scheduleKey || initialScheduleKey;
  await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
    origin,
    reminder_type: reminderType
  });

  const { generation, generationError, fallbackError, failure } = await winbackGraph.invoke(
    { usesLlm: stageConfig.usesLlm, generationError: null, fallbackError: null, failure: null },
    { context: { notification: context, taskType } }
  );
  if (!generation) {
    const error = failure === 'validation'
      ? fallbackError
      : generationError || fallbackError || 'llm_generation_failed';
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: error,
      payloadJson: {
        origin, reminder_type: reminderType,
        generation_error: generationError || error
      }
    });
    throw createAppError('llm_generation_failed', 502, error, { retryable: false });
  }

  try {
    const telegramResult = await sendTelegramTextMessage(normalizedChatId, generation.messageText, {
      botKey: normalizedBotKey
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;
    let persistedMessage = null;

    if (stageConfig.persistToMessages) {
      try {
        persistedMessage = await insertAssistantMessage(normalizedChatId, normalizedBotKey, generation.messageText);
      } catch (persistError) {
        console.warn('winback-send:persist-message-failed', {
          chatId: normalizedChatId,
          botKey: normalizedBotKey,
          reminderType,
          error: sanitizeErrorText(persistError?.message || String(persistError)) || 'persist_failed'
        });
      }
    }

    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'sent',
      telegramMessageId,
      payloadJson: {
        origin,
        reminder_type: reminderType,
        inactive_since_at: context.inactiveSinceAt ? context.inactiveSinceAt.toISOString() : null,
        inactivity_days: context.inactivityDays,
        message_source: generation.source,
        template_family: generation.templateFamily || null,
        variant_index: Number.isInteger(generation.variantIndex) ? generation.variantIndex : null,
        llm_model: generation.model || null,
        llm_response_id: generation.responseId || null,
        message_text: generation.messageText,
        persisted_to_messages: Boolean(persistedMessage)
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
      reminderType,
      taskType,
      scheduleKey: effectiveScheduleKey,
      telegramMessageId,
      messageText: generation.messageText,
      persistedToMessages: Boolean(persistedMessage),
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
        reminder_type: reminderType,
        message_source: generation.source,
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

export async function sendAdminTestWinbackReminder({ chatId, botKey, reminderType }) {
  const normalizedReminderType = parseWinbackReminderType(reminderType);
  if (!normalizedReminderType) {
    throw createAppError('bad_reminder_type', 400, 'bad_reminder_type', { retryable: false });
  }

  const result = await sendWinbackReminderCore({
    chatId,
    botKey,
    reminderType: normalizedReminderType,
    origin: WINBACK_ADMIN_TEST_ORIGIN,
    taskType: resolveWinbackTaskType(normalizedReminderType, WINBACK_ADMIN_TEST_ORIGIN),
    scheduleKey: buildManualTestScheduleKey()
  });

  if (!result) {
    throw createAppError('llm_generation_failed', 502, 'llm_generation_failed', { retryable: false });
  }

  return {
    ok: true,
    chat_id: result.chatId,
    bot_key: result.botKey,
    reminder_type: result.reminderType,
    telegram_message_id: result.telegramMessageId,
    message_text: result.messageText,
    persisted_to_messages: result.persistedToMessages,
    allowlist_active: result.allowlistActive,
    task_type: result.taskType,
    schedule_key: result.scheduleKey
  };
}

async function enqueueWinbackSend(boss, { chatId, botKey, reminderType, taskType, scheduleKey }) {
  return boss.send(
    QUEUE_WINBACK_SEND,
    { chatId, botKey, reminderType, taskType, scheduleKey },
    {
      ...defaultRetryOptions(),
      singletonKey: `winback:${taskType}:${botKey}:${chatId}:${scheduleKey}`
    }
  );
}

export async function handleWinbackScan(jobs, boss) {
  for (const job of jobs) {
    let eligibleCount = 0;
    for (const reminderType of WINBACK_STAGE_ORDER) {
      const eligibleUsers = await scanEligibleWinbackUsers(reminderType);
      eligibleCount += eligibleUsers.length;
      for (const user of eligibleUsers) {
        await enqueueWinbackSend(boss, user);
      }
    }

    console.log('winback-scan', {
      jobId: job.id,
      eligibleCount
    });
  }
}

export async function handleWinbackSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const reminderType = parseWinbackReminderType(job.data?.reminderType);
    const taskType = String(job.data?.taskType || '').trim();
    const scheduleKey = String(job.data?.scheduleKey || '').trim();
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !reminderType || !taskType || !scheduleKey) {
      continue;
    }

    try {
      const result = await sendWinbackReminderCore({
        chatId,
        botKey,
        reminderType,
        origin: WINBACK_AUTOMATED_ORIGIN,
        taskType,
        scheduleKey
      });

      if (!result) {
        console.log('winback-send:skipped', {
          jobId: job.id,
          chatId,
          botKey,
          reminderType,
          scheduleKey
        });
        continue;
      }

      console.log('winback-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        reminderType,
        taskType,
        telegramMessageId: result.telegramMessageId
      });
    } catch (error) {
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);
      const detail = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'winback_send_failed';

      console.warn('winback-send:failed', {
        jobId: job.id,
        chatId,
        botKey,
        reminderType,
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
