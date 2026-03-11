import { createHash, randomUUID } from 'crypto';
import { env } from './env.js';
import { pool } from './db.js';
import { loadBotConfigs } from './bot-configs.js';
import {
  QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
  QUEUE_BROADCAST_RECIPIENT_SEND,
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP,
  QUEUE_ONBOARDING_COMPLETE_SCAN,
  QUEUE_ONBOARDING_COMPLETE_SEND,
  QUEUE_WINBACK_SCAN,
  QUEUE_WINBACK_SEND,
  defaultRetryOptions
} from './queue.js';

const botConfigs = loadBotConfigs();

const BROADCAST_ALLOWED_TIERS = new Set(['free', 'plus', 'pro']);
const BROADCAST_LAST_ACTIVITY_MODES = new Set(['active_within', 'inactive_for', 'never_active']);
const BROADCAST_USAGE_MODES = new Set(['reached', 'percent_gte']);
const BROADCAST_STREAK_MODES = new Set(['gte', 'zero']);
const BROADCAST_MESSAGE_KINDS = new Set(['text', 'photo', 'video']);
const BROADCAST_MEDIA_FILE_ID_MAX_LEN = 512;
const BROADCAST_MEDIA_URL_MAX_LEN = 2048;
const BROADCAST_INLINE_KEYBOARD_MAX_ROWS = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN = 2048;
const TELEGRAM_HTML_ALLOWED_TAGS = new Set([
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'strong',
  'em',
  'strike',
  'del'
]);
const TELEGRAM_HTML_ALIAS_TAGS = { strong: 'b', em: 'i', strike: 's', del: 's' };
const ONBOARDING_TASK_TYPE = 'onboarding_complete';
const ONBOARDING_SCHEDULE_KEY = 'once';
const WINBACK_SEND_CONCURRENCY = 3;
const WINBACK_SCAN_LIMIT = 500;
const WINBACK_MESSAGE_MAX_LEN = 220;
const WINBACK_MESSAGE_MAX_SENTENCES = 2;
const WINBACK_CONTEXT_TURN_LIMIT = 4;
const WINBACK_ADMIN_TEST_ORIGIN = 'admin_test';
const WINBACK_AUTOMATED_ORIGIN = 'automated';
const WINBACK_BEHAVIORAL_SUPPRESSION_TASK_TYPES = ['winback_d3', 'winback_d7', 'winback_d14'];
const WINBACK_REMINDER_TYPES = new Set(['d3', 'd7', 'd14']);
const WINBACK_REPLY_MODE_TEXT = 'text';
const WINBACK_REPLY_MODE_VOICE = 'voice';
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
    maxHours: 360,
    usesLlm: false,
    persistToMessages: false
  }
};
const WINBACK_STAGE_ORDER = ['d3', 'd7', 'd14'];
const LANGUAGE_LABELS = {
  ar: 'Arabic',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  hi: 'Hindi',
  it: 'Italian',
  pl: 'Polish',
  tr: 'Turkish',
  uk: 'Ukrainian'
};
const LOADER_ROTATE_INTERVAL_MS = 5000;
const LOADER_TIMEOUT_SECONDS = 60;
const LOADER_TIMEOUT_MS = LOADER_TIMEOUT_SECONDS * 1000;
const LOADER_ROTATE_CONCURRENCY = 10;

function normalizeBotKey(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  return value.slice(0, 32);
}

function normalizeLanguageCode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'ua' || value === 'uk-ua' || value === 'ua-ua') return 'uk';
  return value.slice(0, 16);
}

function normalizeOptionalText(raw, maxLen) {
  const value = (raw ?? '').toString().trim();
  if (!value) return null;
  return value.slice(0, maxLen);
}

function normalizeStringArray(raw, { maxItems = 12, maxItemLen = 32 } = {}) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((value) => (value ?? '').toString().trim())
    .filter(Boolean)
    .map((value) => value.slice(0, maxItemLen))
    .slice(0, maxItems);
  return items.length ? items : null;
}

function buildPublicBotCatalog(configMap = {}) {
  const keys = new Set([
    ...Object.keys(configMap || {}),
    ...Object.keys(env.telegramBotTokensByBotKey || {})
  ]);

  const catalog = [];
  for (const rawKey of keys) {
    const botKey = normalizeBotKey(rawKey);
    if (!botKey) continue;

    const config = configMap?.[botKey] || configMap?.[rawKey] || {};
    const [fromBase, fromLearning] = botKey.split('-');
    const baseLanguage = normalizeLanguageCode(config.base_language || fromBase || '');
    const learningLanguage = normalizeLanguageCode(config.learning_language || fromLearning || '');
    const botNameRaw = (config.bot_name || '').toString().trim();
    const telegramUrlRaw = (config.telegram_url || '').toString().trim();
    const teacherAvatarEmoji = normalizeOptionalText(config.teacher_avatar_emoji, 8);
    const teacherTaglineUk = normalizeOptionalText(config.teacher_tagline_uk, 220);
    const teacherTaglineEn = normalizeOptionalText(config.teacher_tagline_en, 220);
    const teacherTaglineIt = normalizeOptionalText(config.teacher_tagline_it, 220) || teacherTaglineEn || teacherTaglineUk;
    const teacherStyleTags = normalizeStringArray(config.teacher_style_tags, { maxItems: 12, maxItemLen: 32 });

    catalog.push({
      bot_key: botKey,
      base_language: baseLanguage || null,
      learning_language: learningLanguage || null,
      target_lang: learningLanguage || null,
      bot_name: botNameRaw || null,
      telegram_url: telegramUrlRaw || null,
      teacher_avatar_emoji: teacherAvatarEmoji,
      teacher_tagline_uk: teacherTaglineUk,
      teacher_tagline_en: teacherTaglineEn,
      teacher_tagline_it: teacherTaglineIt,
      teacher_style_tags: teacherStyleTags
    });
  }

  catalog.sort((a, b) => {
    const langA = a.learning_language || '';
    const langB = b.learning_language || '';
    if (langA !== langB) return langA.localeCompare(langB);

    const nameA = a.bot_name || a.bot_key;
    const nameB = b.bot_name || b.bot_key;
    if (nameA !== nameB) return nameA.localeCompare(nameB);

    return a.bot_key.localeCompare(b.bot_key);
  });

  return catalog;
}

const publicBotCatalog = buildPublicBotCatalog(botConfigs);
const publicBotCatalogByKey = new Map(publicBotCatalog.map((bot) => [bot.bot_key, bot]));

function publicBotMetaForKey(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return null;
  return publicBotCatalogByKey.get(botKey) || null;
}

function normalizeReplyMode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  return value === WINBACK_REPLY_MODE_VOICE ? WINBACK_REPLY_MODE_VOICE : WINBACK_REPLY_MODE_TEXT;
}

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

function automatedMessageTestChatIdsSqlParam() {
  const state = getAutomatedMessageTestState();
  return state.active ? state.chatIds : null;
}

function isAutomatedMessageTestChatAllowed(chatId) {
  const state = getAutomatedMessageTestState();
  if (!state.active) return true;
  const normalizedChatId = Number(chatId);
  return Number.isFinite(normalizedChatId) && state.chatIds.includes(normalizedChatId);
}

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

function buildManualTestScheduleKey() {
  return `manual_test:${new Date().toISOString()}:${randomUUID()}`;
}

function stableVariantIndex(seed, size) {
  if (!Number.isInteger(size) || size <= 0) return 0;
  const digest = createHash('sha256').update(String(seed ?? '')).digest();
  return digest.readUInt32BE(0) % size;
}

function applyTemplateSlots(template, slots = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = slots[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeConversationText(raw, maxLen = 280) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.slice(0, maxLen);
}

function countSentences(text) {
  return String(text ?? '')
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function countEmoji(text) {
  const matches = String(text ?? '').match(/\p{Extended_Pictographic}/gu);
  return Array.isArray(matches) ? matches.length : 0;
}

function containsHtmlLikeTags(text) {
  return /<[^>]+>/.test(String(text ?? ''));
}

function extractTopicTitle(rawTopicPack) {
  const topicPack = normalizeTopicPack(rawTopicPack);
  if (!topicPack) return '';
  const candidates = [
    topicPack.title_base,
    topicPack.title_learning,
    topicPack.title,
    topicPack.topic_title,
    topicPack.name
  ];
  for (const candidate of candidates) {
    const title = String(candidate ?? '').trim();
    if (title) return title.slice(0, 120);
  }
  return '';
}

function languageLabelForCode(codeRaw) {
  const code = normalizeLanguageCode(codeRaw);
  if (!code) return 'Unknown';
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

function parseChatIdList(raw) {
  const value = (raw ?? '').toString().trim();
  if (!value) return [];

  const parts = value.split(/[\s,]+/g);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const next = (part ?? '').toString().trim();
    if (!next) continue;
    if (!/^\d{4,20}$/.test(next)) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    if (out.length >= 200) break;
  }
  return out;
}

function clampInteger(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function clampNumber(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLoaderSessionId(raw) {
  const value = (raw ?? '').toString().trim();
  return value ? value.slice(0, 128) : null;
}

function normalizeLoaderMessageId(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function isTruthyLoaderFlag(raw) {
  return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 't';
}

function isTelegramMessageGoneError(error) {
  const message = (error?.telegramDescription || error?.message || '').toString().toLowerCase();
  return (
    message.includes('message to edit not found') ||
    message.includes('message to delete not found') ||
    message.includes('message identifier is not specified') ||
    message.includes('message can\'t be deleted') ||
    message.includes('message can not be edited')
  );
}

function isTelegramNotModifiedError(error) {
  const message = (error?.telegramDescription || error?.message || '').toString().toLowerCase();
  return message.includes('message is not modified');
}

async function fetchLoaderState(chatId, botKey) {
  const normalizedBotKey = normalizeBotKey(botKey);
  const normalizedChatId = Number(chatId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) return null;

  const { rows } = await pool.query(
    `SELECT chat_id, bot_key, stop_flag, updated_at, session_id, message_id, started_at
       FROM loader_flags
      WHERE chat_id = $1
        AND bot_key = $2
      LIMIT 1`,
    [normalizedChatId, normalizedBotKey]
  );
  if (!rows[0]) return null;

  return {
    chat_id: Number(rows[0].chat_id),
    bot_key: normalizeBotKey(rows[0].bot_key),
    stop_flag: isTruthyLoaderFlag(rows[0].stop_flag),
    updated_at: rows[0].updated_at ? new Date(rows[0].updated_at) : null,
    session_id: normalizeLoaderSessionId(rows[0].session_id),
    message_id: normalizeLoaderMessageId(rows[0].message_id),
    started_at: rows[0].started_at ? new Date(rows[0].started_at) : null
  };
}

async function markLoaderStopped(chatId, botKey, sessionId, { clearMessageId = false } = {}) {
  await pool.query(
    `UPDATE loader_flags
        SET stop_flag = true,
            updated_at = NOW(),
            message_id = CASE WHEN $4::boolean THEN NULL ELSE message_id END
      WHERE chat_id = $1
        AND bot_key = $2
        AND ($3::text IS NULL OR session_id = $3)`,
    [Number(chatId), normalizeBotKey(botKey), normalizeLoaderSessionId(sessionId), clearMessageId]
  );
}

function shuffleLoaderMessages(messages) {
  const out = Array.isArray(messages) ? [...messages] : [];
  for (let idx = out.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [out[idx], out[swapIdx]] = [out[swapIdx], out[idx]];
  }
  return out;
}

function pickNextLoaderText(messages, index, lastDisplayedText) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { text: '', nextIndex: index };
  }

  let nextIndex = Number.isFinite(index) ? index : 0;
  let text = messages[nextIndex % messages.length] || '';

  if (messages.length > 1 && text && text === lastDisplayedText) {
    nextIndex += 1;
    text = messages[nextIndex % messages.length] || '';
  }

  return {
    text,
    nextIndex: nextIndex + 1
  };
}

function normalizeBroadcastFilters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const usernameRaw = (source.username ?? '').toString().trim();
  const username = usernameRaw ? usernameRaw.slice(0, 64) : null;
  const chatIds = parseChatIdList(source.chatIds ?? source.chat_ids ?? source.chatIdsCsv ?? source.chat_ids_csv);
  const normalizedChatIds = chatIds.length > 0 ? chatIds : null;

  const plansProvided = Array.isArray(source.plans);
  const plansRaw = plansProvided ? source.plans : [];
  const plans = Array.from(
    new Set(
      plansRaw
        .map((value) => value.toString().trim().toLowerCase())
        .filter((value) => BROADCAST_ALLOWED_TIERS.has(value))
    )
  );
  let normalizedPlans = null;
  if (plansProvided) {
    if (plans.length === 0) normalizedPlans = [];
    else if (plans.length < BROADCAST_ALLOWED_TIERS.size) normalizedPlans = plans;
  }

  const lastActivityModeRaw = (source.lastActivityMode ?? source.last_activity_mode ?? '').toString().trim();
  const lastActivityMode = BROADCAST_LAST_ACTIVITY_MODES.has(lastActivityModeRaw) ? lastActivityModeRaw : null;
  const lastActivityDays = clampInteger(source.lastActivityDays ?? source.last_activity_days, {
    min: 1,
    max: 3650,
    fallback: 7
  });

  const usageModeRaw = (source.usageMode ?? source.usage_mode ?? '').toString().trim();
  const usageMode = BROADCAST_USAGE_MODES.has(usageModeRaw) ? usageModeRaw : null;
  const usagePercent = clampNumber(source.usagePercent ?? source.usage_percent, {
    min: 0,
    max: 100,
    fallback: 80
  });

  const streakModeRaw = (source.streakMode ?? source.streak_mode ?? '').toString().trim();
  const streakMode = BROADCAST_STREAK_MODES.has(streakModeRaw) ? streakModeRaw : null;
  const streakDays = clampInteger(source.streakDays ?? source.streak_days, {
    min: 1,
    max: 3650,
    fallback: 3
  });

  const botsProvided = Array.isArray(source.bots);
  const botsRaw = botsProvided ? source.bots : [];
  const bots = Array.from(
    new Set(
      botsRaw
        .map((value) => normalizeBotKey(value))
        .filter(Boolean)
    )
  );
  const normalizedBots = botsProvided && bots.length > 0 ? bots : null;

  return {
    username,
    chatIds: normalizedChatIds,
    plans: normalizedPlans,
    lastActivityMode,
    lastActivityDays,
    usageMode,
    usagePercent,
    streakMode,
    streakDays,
    bots: normalizedBots
  };
}

function broadcastAudienceParams(filters, range) {
  const chatIds = Array.isArray(filters.chatIds) ? filters.chatIds : null;
  const plans = Array.isArray(filters.plans) ? filters.plans : null;
  const bots = Array.isArray(filters.bots) ? filters.bots : null;
  return [
    filters.username,
    chatIds,
    plans,
    filters.lastActivityMode,
    filters.lastActivityDays,
    filters.usageMode,
    filters.usagePercent,
    bots,
    filters.streakMode,
    filters.streakDays,
    range.from.toISOString(),
    range.to.toISOString()
  ];
}

function broadcastAudienceSql(selectSql, suffixSql = '') {
  return `WITH params AS (
      SELECT
        $11::timestamptz AS from_ts,
        $12::timestamptz AS to_ts
    ),
    effective_users AS (
      SELECT
        u.chat_id,
        u.username,
        u.first_name,
        ub.level,
        ub.bot_key,
        u.created_at,
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
      INNER JOIN user_bots ub ON ub.chat_id = u.chat_id
      WHERE COALESCE(ub.is_active, true) = true
    ),
    activity_days AS (
      SELECT DISTINCT activity.chat_id, activity.day_utc
      FROM (
        SELECT
          v.chat_id,
          date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc
        FROM voice_usage_events v, params
        WHERE v.occurred_at >= (SELECT from_ts FROM params)
          AND v.occurred_at < (SELECT to_ts FROM params)

        UNION

        SELECT
          m.chat_id,
          date_trunc('day', m.created_at AT TIME ZONE 'UTC')::date AS day_utc
        FROM messages m, params
        WHERE m.role = 'user'
          AND m.created_at >= (SELECT from_ts FROM params)
          AND m.created_at < (SELECT to_ts FROM params)
      ) activity
      JOIN (SELECT DISTINCT chat_id FROM effective_users) u ON u.chat_id = activity.chat_id
    ),
    streak_groups AS (
      SELECT
        chat_id,
        day_utc,
        day_utc - ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY day_utc)::int AS grp
      FROM activity_days
    ),
    streaks AS (
      SELECT
        chat_id,
        COUNT(*)::int AS streak_days
      FROM streak_groups
      GROUP BY chat_id, grp
    ),
    max_streaks AS (
      SELECT
        chat_id,
        MAX(streak_days)::int AS streak_days
      FROM streaks
      GROUP BY chat_id
    ),
    last_activity AS (
      SELECT
        v.chat_id,
        MAX(v.occurred_at) AS last_activity_at
      FROM voice_usage_events v
      GROUP BY v.chat_id
    ),
    enriched AS (
      SELECT
        e.chat_id,
        e.username,
        e.first_name,
        e.level,
        e.created_at,
        e.bot_key,
        e.effective_tier,
        a.last_activity_at,
        COALESCE(p.voice_limit_period, 'lifetime') AS limit_period,
        COALESCE(u.used_total, 0)::int AS used_total,
        COALESCE(p.voice_seconds_limit, 0)::int AS limit_total,
        COALESCE(ms.streak_days, 0)::int AS streak_days,
        CASE
          WHEN COALESCE(p.voice_seconds_limit, 0) > 0
            THEN (COALESCE(u.used_total, 0)::numeric * 100.0)
              / COALESCE(p.voice_seconds_limit, 0)
          ELSE 0
        END::numeric AS usage_percent,
        (
          COALESCE(p.voice_seconds_limit, 0) > 0
          AND
          COALESCE(u.used_total, 0) >= COALESCE(p.voice_seconds_limit, 0)
        ) AS limit_reached
      FROM effective_users e
      LEFT JOIN last_activity a ON a.chat_id = e.chat_id
      LEFT JOIN plans p ON p.tier = e.effective_tier
      LEFT JOIN max_streaks ms ON ms.chat_id = e.chat_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(uh.in_voice_seconds + uh.out_voice_seconds), 0)::int AS used_total
        FROM usage_hourly uh
        WHERE uh.chat_id = e.chat_id
          AND (
            COALESCE(p.voice_limit_period, 'lifetime') <> 'month'
            OR uh.hour_start >= date_trunc('month', NOW())
          )
      ) u ON true
    ),
    filtered AS (
      SELECT
        e.chat_id,
        e.username,
        e.first_name,
        e.level,
        e.created_at,
        e.bot_key,
        e.effective_tier,
        e.last_activity_at,
        e.limit_period,
        e.used_total,
        e.limit_total,
        e.usage_percent,
        e.limit_reached,
        e.streak_days
      FROM enriched e
      WHERE ($1::text IS NULL OR e.username ILIKE ('%' || $1::text || '%'))
        AND ($2::bigint[] IS NULL OR e.chat_id = ANY($2::bigint[]))
        AND ($3::text[] IS NULL OR e.effective_tier = ANY($3::text[]))
        AND (
          $4::text IS NULL
          OR ($4::text = 'active_within'
              AND e.last_activity_at IS NOT NULL
              AND e.last_activity_at >= NOW() - make_interval(days => $5::int))
          OR ($4::text = 'inactive_for'
              AND (e.last_activity_at IS NULL OR e.last_activity_at < NOW() - make_interval(days => $5::int)))
          OR ($4::text = 'never_active' AND e.last_activity_at IS NULL)
        )
        AND (
          $6::text IS NULL
          OR ($6::text = 'reached' AND e.limit_reached)
          OR ($6::text = 'percent_gte' AND e.usage_percent >= $7::numeric)
        )
        AND ($8::text[] IS NULL OR e.bot_key = ANY($8::text[]))
        AND (
          $9::text IS NULL
          OR ($9::text = 'gte' AND e.streak_days >= $10::int)
          OR ($9::text = 'zero' AND e.streak_days = 0)
        )
    )
    SELECT ${selectSql}
    FROM filtered f
    ${suffixSql}`;
}

function normalizeBroadcastMediaFileIds(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const botKey = normalizeBotKey(key);
    if (!botKey) continue;
    const fileIdRaw = (value ?? '').toString().trim();
    if (!fileIdRaw) continue;
    out[botKey] = fileIdRaw.slice(0, BROADCAST_MEDIA_FILE_ID_MAX_LEN);
  }
  return Object.keys(out).length ? out : null;
}

function normalizeBroadcastReplyMarkup(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, replyMarkup: null };
  }
  if (typeof raw !== 'object') {
    return { ok: false, error: 'bad_inline_keyboard' };
  }

  const sourceRows = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw.inline_keyboard) ? raw.inline_keyboard : null);
  if (!Array.isArray(sourceRows)) {
    return { ok: false, error: 'bad_inline_keyboard' };
  }
  if (sourceRows.length > BROADCAST_INLINE_KEYBOARD_MAX_ROWS) {
    return { ok: false, error: 'inline_keyboard_too_many_rows' };
  }

  const normalizedRows = [];
  for (const rowRaw of sourceRows) {
    if (!Array.isArray(rowRaw)) {
      return { ok: false, error: 'bad_inline_keyboard_row' };
    }
    if (rowRaw.length === 0) continue;
    if (rowRaw.length > BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW) {
      return { ok: false, error: 'inline_keyboard_too_many_buttons_in_row' };
    }

    const row = [];
    for (const buttonRaw of rowRaw) {
      if (!buttonRaw || typeof buttonRaw !== 'object' || Array.isArray(buttonRaw)) {
        return { ok: false, error: 'bad_inline_keyboard_button' };
      }

      const text = (buttonRaw.text ?? '').toString().trim();
      if (!text) return { ok: false, error: 'inline_keyboard_button_text_required' };
      if (text.length > BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN) {
        return { ok: false, error: 'inline_keyboard_button_text_too_long' };
      }

      const callbackData = (buttonRaw.callback_data ?? buttonRaw.callbackData ?? '').toString().trim();
      const url = (buttonRaw.url ?? '').toString().trim();
      if (callbackData && url) {
        return { ok: false, error: 'inline_keyboard_button_conflict' };
      }
      if (!callbackData && !url) {
        return { ok: false, error: 'inline_keyboard_button_action_required' };
      }
      if (callbackData.length > BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN) {
        return { ok: false, error: 'inline_keyboard_callback_data_too_long' };
      }
      if (url) {
        if (url.length > BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN) {
          return { ok: false, error: 'inline_keyboard_url_too_long' };
        }
        let parsedUrl = null;
        try {
          parsedUrl = new URL(url);
        } catch {
          return { ok: false, error: 'inline_keyboard_bad_url' };
        }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return { ok: false, error: 'inline_keyboard_bad_url_scheme' };
        }
      }

      const button = { text };
      if (callbackData) button.callback_data = callbackData;
      if (url) button.url = url;
      row.push(button);
    }

    if (row.length > 0) normalizedRows.push(row);
  }

  return {
    ok: true,
    replyMarkup: normalizedRows.length ? { inline_keyboard: normalizedRows } : null
  };
}

function sanitizeErrorText(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;
  return raw.slice(0, 500);
}

function escapeTelegramHtmlText(value) {
  return String(value ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeBrokenTelegramTags(input) {
  return String(input ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*[»›]/g, '<$1$2>')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*[”"']\s*>/g, '<$1$2>')
    .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\s*>/g, '<$1$2>');
}

function sanitizeTelegramHtml(value) {
  const normalized = normalizeBrokenTelegramTags(value).replace(/\r\n/g, '\n');
  const parts = normalized.split(/(<[^>]+>)/g);
  const stack = [];
  const out = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('<') && part.endsWith('>')) {
      const match = part.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^>]*)?>$/);
      if (!match) {
        out.push(escapeTelegramHtmlText(part));
        continue;
      }

      const isClose = match[1] === '/';
      const rawTag = match[2].toLowerCase();
      const tag = TELEGRAM_HTML_ALIAS_TAGS[rawTag] || rawTag;

      if (!TELEGRAM_HTML_ALLOWED_TAGS.has(rawTag) && !TELEGRAM_HTML_ALLOWED_TAGS.has(tag)) {
        out.push(escapeTelegramHtmlText(part));
        continue;
      }

      if (isClose) {
        const idx = stack.lastIndexOf(tag);
        if (idx === -1) continue;
        while (stack.length > idx) {
          out.push(`</${stack.pop()}>`);
        }
        continue;
      }

      out.push(`<${tag}>`);
      stack.push(tag);
      continue;
    }

    out.push(escapeTelegramHtmlText(part));
  }

  while (stack.length) {
    out.push(`</${stack.pop()}>`);
  }

  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTelegramParseMode(value) {
  const mode = String(value ?? '').trim().toUpperCase();
  if (mode === 'HTML') return 'HTML';
  if (mode === 'MARKDOWNV2' || mode === 'MARKDOWN_V2') return 'MarkdownV2';
  return null;
}

function classifyPermanentTelegramFailure(err) {
  const status = Number(err?.telegramStatus);
  const description = (err?.telegramDescription || err?.message || '').toString().toLowerCase();

  if (description.includes('bot was blocked by the user')) return 'blocked';
  if (description.includes('user is deactivated')) return 'deactivated';
  if (description.includes('chat not found')) return 'chat_not_found';
  if (description.includes("bot can't initiate conversation with a user")) return 'chat_not_found';
  if (status === 403) return 'forbidden';
  return null;
}

async function updateUserDeliveryState(chatId, { status, lastError, inactiveReason, botKey = null }) {
  const normalizedBotKey = normalizeBotKey(botKey);

  if (status === 'sent') {
    if (normalizedBotKey) {
      await pool.query(
        `UPDATE user_bots
            SET is_active = true,
                updated_at = NOW()
          WHERE chat_id = $1
            AND bot_key = $2`,
        [chatId, normalizedBotKey]
      );
    }

    await pool.query(
      `UPDATE users
          SET inactive_reason = NULL,
              inactive_at = NULL,
              last_delivery_error = NULL,
              updated_at = NOW()
        WHERE chat_id = $1`,
      [chatId]
    );
    return;
  }

  if (inactiveReason) {
    if (normalizedBotKey) {
      await pool.query(
        `UPDATE user_bots
            SET is_active = false,
                updated_at = NOW()
          WHERE chat_id = $1
            AND bot_key = $2`,
        [chatId, normalizedBotKey]
      );
    }

    await pool.query(
      `WITH active_bots AS (
         SELECT EXISTS (
           SELECT 1
           FROM user_bots
           WHERE chat_id = $1
             AND COALESCE(is_active, true) = true
         ) AS has_active_bot
       )
       UPDATE users u
          SET inactive_reason = CASE
                WHEN a.has_active_bot THEN NULL
                ELSE $2
              END,
              inactive_at = CASE
                WHEN a.has_active_bot THEN NULL
                WHEN u.inactive_at IS NULL THEN NOW()
                ELSE u.inactive_at
              END,
              last_delivery_error = $3,
              updated_at = NOW()
         FROM active_bots a
        WHERE u.chat_id = $1`,
      [chatId, inactiveReason, lastError]
    );
    return;
  }

  if (lastError) {
    await pool.query(
      `UPDATE users
          SET last_delivery_error = $2,
              updated_at = NOW()
        WHERE chat_id = $1
          AND EXISTS (
            SELECT 1
            FROM user_bots ub
            WHERE ub.chat_id = users.chat_id
              AND COALESCE(ub.is_active, true) = true
          )`,
      [chatId, lastError]
    );
  }
}

function resolveTelegramBotToken(botKeyRaw) {
  const requested = normalizeBotKey(botKeyRaw);
  if (requested && env.telegramBotTokensByBotKey[requested]) {
    return env.telegramBotTokensByBotKey[requested];
  }
  const fallback = normalizeBotKey(env.defaultBotKey) || 'uk-de';
  if (env.telegramBotTokensByBotKey[fallback]) {
    return env.telegramBotTokensByBotKey[fallback];
  }
  const first = Object.values(env.telegramBotTokensByBotKey)[0];
  return typeof first === 'string' && first.trim() ? first.trim() : null;
}

async function callTelegramApi(botKey, method, body) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description || `telegram_http_${response.status}`;
    const err = new Error(description);
    err.telegramStatus = response.status;
    err.telegramDescription = payload?.description || null;
    throw err;
  }

  return payload.result || null;
}

async function sendTelegramTextMessage(chatId, text, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
  const body = {
    chat_id: Number(chatId),
    text,
    disable_web_page_preview: true
  };
  const normalizedParseMode = normalizeTelegramParseMode(parseMode);
  if (normalizedParseMode) body.parse_mode = normalizedParseMode;
  if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(botKey, 'sendMessage', body);
}

async function sendTelegramPhotoMessage(chatId, photo, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
  const body = {
    chat_id: Number(chatId),
    photo: (photo ?? '').toString()
  };
  const safeCaption = (caption ?? '').toString().trim();
  if (safeCaption) body.caption = safeCaption;
  const normalizedParseMode = normalizeTelegramParseMode(parseMode);
  if (safeCaption && normalizedParseMode) body.parse_mode = normalizedParseMode;
  if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(botKey, 'sendPhoto', body);
}

async function sendTelegramVideoMessage(chatId, video, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
  const body = {
    chat_id: Number(chatId),
    video: (video ?? '').toString(),
    supports_streaming: true
  };
  const safeCaption = (caption ?? '').toString().trim();
  if (safeCaption) body.caption = safeCaption;
  const normalizedParseMode = normalizeTelegramParseMode(parseMode);
  if (safeCaption && normalizedParseMode) body.parse_mode = normalizedParseMode;
  if (replyMarkup && typeof replyMarkup === 'object' && !Array.isArray(replyMarkup)) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(botKey, 'sendVideo', body);
}

async function editTelegramMessageText(chatId, messageId, text, { botKey = null } = {}) {
  return callTelegramApi(botKey, 'editMessageText', {
    chat_id: Number(chatId),
    message_id: Number(messageId),
    text
  });
}

async function deleteTelegramMessage(chatId, messageId, { botKey = null } = {}) {
  return callTelegramApi(botKey, 'deleteMessage', {
    chat_id: Number(chatId),
    message_id: Number(messageId)
  });
}

function getBotLocale(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return {};
  const config = botConfigs[botKey] || botConfigs[botKeyRaw] || {};
  return config.locale && typeof config.locale === 'object' ? config.locale : {};
}

const WINBACK_DEFAULT_LOCALE = {
  reply_cta_voice: 'send a short voice message',
  reply_cta_text: 'write one short sentence',
  d3_fallback_variants: [
    'Ready to continue? {{reply_cta_label}} in {{target_language_label}} and I will take it from there.',
    'Want to pick this back up? {{reply_cta_label}} in {{target_language_label}}.'
  ],
  d7_fallback_variants: [
    'Want an easy restart? {{reply_cta_label}} in {{target_language_label}} and I will help.',
    'We can restart small. {{reply_cta_label}} in {{target_language_label}}.'
  ],
  d14: {
    default: [
      'No pressure. We can restart from zero anytime. {{reply_cta_label}} in {{target_language_label}} when you want.',
      'Whenever you are ready, we can start fresh. {{reply_cta_label}} in {{target_language_label}}.'
    ],
    topic: [
      'Want to come back to {{topic_title}}? {{reply_cta_label}} in {{target_language_label}} and we will restart gently.',
      '{{topic_title}} is still a good place to restart. {{reply_cta_label}} in {{target_language_label}} when you want.'
    ],
    streak: [
      'You already built a {{streak_best}}-day streak once. We can start again with one small step. {{reply_cta_label}} in {{target_language_label}}.',
      'Your best streak was {{streak_best}} days. Restarting can be just one short message. {{reply_cta_label}} in {{target_language_label}}.'
    ],
    voice: [
      'A quick voice reply is enough to restart. {{reply_cta_label}} in {{target_language_label}} when you feel like it.',
      'We can make the comeback easy. {{reply_cta_label}} in {{target_language_label}} and we will go from there.'
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
      topic: normalizeWinbackVariantArray(rawD14.topic, WINBACK_DEFAULT_LOCALE.d14.topic),
      streak: normalizeWinbackVariantArray(rawD14.streak, WINBACK_DEFAULT_LOCALE.d14.streak),
      voice: normalizeWinbackVariantArray(rawD14.voice, WINBACK_DEFAULT_LOCALE.d14.voice)
    }
  };
}

function resolveTargetLanguageLabel(botKeyRaw, locale = getBotLocale(botKeyRaw)) {
  const botMeta = publicBotMetaForKey(botKeyRaw);
  const learningLanguage = botMeta?.learning_language || botMeta?.target_lang || normalizeBotKey(botKeyRaw)?.split('-')?.[1] || '';
  const localeLabelKey = learningLanguage ? `lang_label_${learningLanguage}` : '';
  const localeValue = localeLabelKey ? String(locale?.[localeLabelKey] || '').trim() : '';
  return localeValue || languageLabelForCode(learningLanguage);
}

function resolveReplyCtaLabel(replyMode, winbackLocale) {
  return normalizeReplyMode(replyMode) === WINBACK_REPLY_MODE_VOICE
    ? winbackLocale.reply_cta_voice
    : winbackLocale.reply_cta_text;
}

function normalizeTopicPack(raw) {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

function buildOnboardingReplyMarkup(state, locale) {
  const topicPack = normalizeTopicPack(state.topic_pack_json);
  const topicTitle = state.topic_enabled && topicPack && typeof topicPack.title_base === 'string'
    ? topicPack.title_base.trim()
    : '';
  const topicValue = topicTitle || String(locale.keyboard_btn_topic_none || 'Choose topic').trim() || 'Choose topic';
  const replyMode = String(state.reply_mode || 'voice').trim().toLowerCase() === 'text' ? 'text' : 'voice';
  const voiceValue = replyMode === 'voice'
    ? String(locale.keyboard_btn_voice_voice || 'Voice').trim() || 'Voice'
    : String(locale.keyboard_btn_voice_text || 'Text').trim() || 'Text';
  const xpPrefix = String(locale.keyboard_btn_xp_prefix || 'XP').trim() || 'XP';
  const xpTotal = Number(state.xp_total ?? 0);
  const xpLevel = Number(state.xp_level ?? 1) || 1;
  const levelValue = String(state.level || 'a1').trim().toUpperCase() || 'A1';

  return {
    keyboard: [
      [
        { text: `· 🧩 ${topicValue}` },
        { text: `· 📚 ${levelValue}` }
      ],
      [
        { text: `· 🎤 ${voiceValue}` },
        { text: `· ${xpPrefix}: ${xpTotal} • L${xpLevel}` }
      ]
    ],
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
       ub.reply_mode,
       COALESCE(ub.topic_enabled, false) AS topic_enabled,
       ub.topic_pack_json,
       COALESCE(up.xp_total, 0)::int AS xp_total,
       FLOOR(COALESCE(up.xp_total, 0) / 200.0)::int + 1 AS xp_level
     FROM user_bots ub
     LEFT JOIN user_progress up
       ON up.chat_id = ub.chat_id
      AND up.bot_key = ub.bot_key
     WHERE ub.chat_id = $1
       AND ub.bot_key = $2
       AND COALESCE(ub.is_active, true) = true
     LIMIT 1`,
    [chatId, botKey]
  );

  return rows[0] || null;
}

function createAppError(code, statusCode, detail = code, extras = {}) {
  const error = new Error(detail || code);
  error.code = code;
  error.statusCode = statusCode;
  error.detail = detail || code;
  Object.assign(error, extras);
  return error;
}

async function hasSentScheduledDispatch(taskType, chatId, botKey, scheduleKey) {
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

async function markScheduledDispatchAttemptStarted(taskType, chatId, botKey, scheduleKey, payloadJson = {}) {
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

async function finalizeScheduledDispatchAttempt(
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
       COALESCE(ub.topic_enabled, false) AS topic_enabled,
       ub.topic_pack_json,
       ub.last_seen_at,
       COALESCE(up.xp_total, 0)::int AS xp_total,
       COALESCE(up.streak_current, 0)::int AS streak_current,
       COALESCE(up.streak_best, 0)::int AS streak_best,
       COALESCE(us.summary, '') AS summary,
       last_user.created_at AS last_user_message_at,
       last_user.content AS last_user_message_text,
       last_assistant.created_at AS last_assistant_message_at,
       last_assistant.content AS last_assistant_message_text
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     LEFT JOIN user_progress up
       ON up.chat_id = ub.chat_id
      AND up.bot_key = ub.bot_key
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
    topicEnabled: row.topic_enabled === true || row.topic_enabled === 1 || row.topic_enabled === 't',
    topicPackJson: normalizeTopicPack(row.topic_pack_json),
    topicTitle: extractTopicTitle(row.topic_pack_json),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    inactiveSinceAt,
    inactivityHours,
    summary: normalizeOptionalText(row.summary, 2000) || '',
    xpTotal: clampInteger(row.xp_total, { min: 0, max: 10000000, fallback: 0 }),
    streakCurrent: clampInteger(row.streak_current, { min: 0, max: 100000, fallback: 0 }),
    streakBest: clampInteger(row.streak_best, { min: 0, max: 100000, fallback: 0 }),
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

async function hasRecentWinbackSuppression(chatId) {
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
      [normalizedChatId, WINBACK_BEHAVIORAL_SUPPRESSION_TASK_TYPES]
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
       AND ${inactiveSinceSql} > NOW() - ($1::int * interval '1 hour')
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
      stageConfig.maxHours,
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

  if (context.topicEnabled && context.topicTitle) {
    return { family: 'd14.topic', variants: context.winbackLocale.d14.topic };
  }
  if (context.streakBest >= 3) {
    return { family: 'd14.streak', variants: context.winbackLocale.d14.streak };
  }
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
    topic_title: context.topicTitle,
    target_language_label: context.targetLanguageLabel,
    reply_cta_label: context.replyCtaLabel,
    streak_best: context.streakBest
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
  const systemPrompt = [
    'You write short win-back reminder messages for a Telegram language-learning bot.',
    `Write the message in ${context.baseLanguageLabel}.`,
    `The target practice language is ${context.targetLanguageLabel}.`,
    `Goal: ${reminderGoal}.`,
    'Return JSON only with a single field: message_text.',
    'Rules:',
    `- Max ${WINBACK_MESSAGE_MAX_LEN} characters`,
    `- Max ${WINBACK_MESSAGE_MAX_SENTENCES} sentences`,
    '- One clear CTA only',
    '- Plain text only, no HTML or markdown',
    '- At most one emoji',
    '- Helpful teacher tone, never guilt or pressure',
    '- Do not say that you noticed inactivity',
    '- Do not mention billing, plans, or upgrades',
    '- Do not quote old user messages verbatim'
  ].join('\n');

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
      topic_enabled: context.topicEnabled,
      topic_title: context.topicTitle || null,
      summary: context.summary || null,
      xp_total: context.xpTotal,
      streak_current: context.streakCurrent,
      streak_best: context.streakBest,
      inactivity_days: context.inactivityDays
    },
    conversation: {
      last_user_message: context.lastUserMessageText || null,
      last_assistant_message: context.lastAssistantMessageText || null,
      recent_turns: context.reminderType === 'd3' ? context.recentTurns : []
    }
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.reminderLlmModel,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload) }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'winback_message',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              message_text: {
                type: 'string',
                minLength: 1,
                maxLength: WINBACK_MESSAGE_MAX_LEN
              }
            },
            required: ['message_text'],
            additionalProperties: false
          }
        }
      }
    })
  });

  let payloadJson = null;
  try {
    payloadJson = await response.json();
  } catch {
    payloadJson = null;
  }

  if (!response.ok) {
    const detail = sanitizeErrorText(payloadJson?.error?.message || `openai_http_${response.status}`) || `openai_http_${response.status}`;
    throw createAppError('openai_request_failed', 502, detail, { retryable: response.status >= 500 });
  }

  const outputText = String(payloadJson?.output_text || '').trim();
  if (!outputText) {
    throw createAppError('openai_empty_output', 502, 'openai_empty_output', { retryable: false });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw createAppError('openai_invalid_json', 502, 'openai_invalid_json', { retryable: false });
  }

  return {
    messageText: String(parsed?.message_text || '').trim(),
    source: 'llm',
    model: String(payloadJson?.model || env.reminderLlmModel || '').trim() || env.reminderLlmModel,
    responseId: String(payloadJson?.id || '').trim() || null,
    usage: payloadJson?.usage || null,
    taskType
  };
}

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
  if (!Number.isFinite(inactivityHours) || inactivityHours < stageConfig.minHours || inactivityHours >= stageConfig.maxHours) {
    return { ok: false, code: 'outside_inactivity_window', context };
  }

  if (await hasSentScheduledDispatch(stageConfig.taskType, context.chatId, context.botKey, currentScheduleKey)) {
    return { ok: false, code: 'already_sent', context };
  }

  const suppression = await hasRecentWinbackSuppression(context.chatId);
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

  let generation = null;
  let generationError = null;
  if (stageConfig.usesLlm) {
    try {
      generation = await generateWinbackMessageWithLlm(context, taskType);
      const validation = validateWinbackMessageText(generation.messageText, context);
      if (!validation.ok) {
        generationError = validation.error;
        generation = null;
      } else {
        generation.messageText = validation.messageText;
      }
    } catch (error) {
      generationError = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'llm_generation_failed';
      generation = null;
    }
  }

  if (!generation) {
    const fallback = buildWinbackFallbackMessage(context, taskType);
    if (!fallback.ok) {
      await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
        status: 'failed',
        lastError: generationError || fallback.error || 'llm_generation_failed',
        payloadJson: {
          origin,
          reminder_type: reminderType,
          generation_error: generationError || fallback.error || 'llm_generation_failed'
        }
      });
      throw createAppError(
        'llm_generation_failed',
        502,
        generationError || fallback.error || 'llm_generation_failed',
        { retryable: false }
      );
    }

    const validation = validateWinbackMessageText(fallback.messageText, context);
    if (!validation.ok) {
      await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
        status: 'failed',
        lastError: validation.error,
        payloadJson: {
          origin,
          reminder_type: reminderType,
          generation_error: generationError || validation.error
        }
      });
      throw createAppError('llm_generation_failed', 502, validation.error, { retryable: false });
    }

    generation = {
      ...fallback,
      messageText: validation.messageText
    };
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

async function refreshBroadcastCampaignStats(campaignId, { status = null, errorText = null, setFinishedAt = false } = {}) {
  await pool.query(
    `WITH stats AS (
       SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
       FROM broadcast_recipients
       WHERE campaign_id = $1
     )
     UPDATE broadcast_campaigns c
        SET total_recipients = s.total_count,
            sent_count = s.sent_count,
            failed_count = s.failed_count,
            status = COALESCE($2::text, c.status),
            error_text = CASE
              WHEN $3::text IS NOT NULL THEN $3::text
              ELSE c.error_text
            END,
            finished_at = CASE
              WHEN $4::boolean THEN NOW()
              ELSE c.finished_at
            END,
            updated_at = NOW()
       FROM stats s
      WHERE c.id = $1`,
    [campaignId, status, errorText, setFinishedAt]
  );
}

async function finalizeBroadcastCampaignIfDone(campaignId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
     FROM broadcast_recipients
     WHERE campaign_id = $1`,
    [campaignId]
  );

  const pendingCount = Number(rows[0]?.pending_count || 0);
  if (pendingCount > 0) {
    await refreshBroadcastCampaignStats(campaignId, { status: 'sending', setFinishedAt: false });
    return false;
  }

  await refreshBroadcastCampaignStats(campaignId, { status: 'completed', setFinishedAt: true });
  return true;
}

async function fetchBroadcastRecipientPayload(campaignId, chatId, botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  const { rows } = await pool.query(
    `SELECT
       c.id AS campaign_id,
       c.status AS campaign_status,
       c.message_text,
       c.message_kind,
       c.media_url,
       c.media_file_id,
       c.media_file_ids,
       c.reply_markup,
       r.chat_id,
       r.bot_key,
       r.status AS recipient_status,
       r.attempts
     FROM broadcast_campaigns c
     JOIN broadcast_recipients r
       ON r.campaign_id = c.id
     WHERE c.id = $1
       AND r.chat_id = $2
       AND r.bot_key = $3
     LIMIT 1`,
    [campaignId, chatId, botKey]
  );

  return rows[0] || null;
}

async function updateBroadcastRecipient(campaignId, chatId, botKeyRaw, { status, lastError = null, telegramMessageId = null }) {
  const botKey = normalizeBotKey(botKeyRaw);
  await pool.query(
    `UPDATE broadcast_recipients
        SET status = $4::text,
            attempts = attempts + 1,
            last_error = $5::text,
            sent_at = CASE
              WHEN $4::text = 'sent' THEN NOW()
              ELSE sent_at
            END,
            telegram_message_id = CASE
              WHEN $6::bigint IS NOT NULL THEN $6::bigint
              ELSE telegram_message_id
            END,
            updated_at = NOW()
      WHERE campaign_id = $1
        AND chat_id = $2
        AND bot_key = $3`,
    [campaignId, chatId, botKey, status, lastError, telegramMessageId]
  );
}

async function incrementBroadcastRecipientAttempt(campaignId, chatId, botKeyRaw, lastError) {
  const botKey = normalizeBotKey(botKeyRaw);
  await pool.query(
    `UPDATE broadcast_recipients
        SET attempts = attempts + 1,
            last_error = $4::text,
            updated_at = NOW()
      WHERE campaign_id = $1
        AND chat_id = $2
        AND bot_key = $3`,
    [campaignId, chatId, botKey, lastError]
  );
}

async function scanBroadcastRecipients(campaignId, limit, offset) {
  const { rows } = await pool.query(
    `SELECT chat_id, bot_key
       FROM broadcast_recipients
      WHERE campaign_id = $1
        AND status = 'pending'
      ORDER BY chat_id ASC, bot_key ASC
      LIMIT $2
      OFFSET $3`,
    [campaignId, limit, offset]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key)
  }));
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

export async function enqueueLoaderRotateJob(boss, { chatId, botKey, sessionId, waitingText, messages }) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  const normalizedSessionId = normalizeLoaderSessionId(sessionId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey || !normalizedSessionId) {
    return null;
  }

  return boss.send(
    QUEUE_LOADER_ROTATE,
    {
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      sessionId: normalizedSessionId,
      waitingText: (waitingText ?? '').toString(),
      messages: Array.isArray(messages) ? messages : []
    },
    {
      retryLimit: 0,
      singletonKey: `loader_rotate:${normalizedBotKey}:${normalizedChatId}:${normalizedSessionId}`
    }
  );
}

export async function enqueueLoaderTimeoutCleanupJob(boss, { chatId, botKey, sessionId }) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  const normalizedSessionId = normalizeLoaderSessionId(sessionId);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey || !normalizedSessionId) {
    return null;
  }

  return boss.send(
    QUEUE_LOADER_TIMEOUT_CLEANUP,
    {
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      sessionId: normalizedSessionId
    },
    {
      retryLimit: 0,
      startAfter: LOADER_TIMEOUT_SECONDS,
      singletonKey: `loader_timeout:${normalizedBotKey}:${normalizedChatId}:${normalizedSessionId}`
    }
  );
}

export async function enqueueBroadcastCampaign(boss, campaignId) {
  const id = Number(campaignId);
  if (!Number.isFinite(id) || id <= 0) return null;

  return boss.send(
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    { campaignId: id },
    {
      ...defaultRetryOptions(),
      singletonKey: `broadcast_campaign:${id}`
    }
  );
}

async function enqueueBroadcastRecipientJob(boss, { campaignId, chatId, botKey }) {
  return boss.send(
    QUEUE_BROADCAST_RECIPIENT_SEND,
    { campaignId, chatId, botKey },
    {
      ...defaultRetryOptions(),
      singletonKey: `broadcast_recipient:${campaignId}:${botKey}:${chatId}`
    }
  );
}

async function cleanupLoaderMessage({ chatId, botKey, sessionId, reason }) {
  const state = await fetchLoaderState(chatId, botKey);
  if (!state || state.session_id !== sessionId) return false;

  const messageId = normalizeLoaderMessageId(state.message_id);
  if (messageId) {
    try {
      await deleteTelegramMessage(chatId, messageId, { botKey });
    } catch (error) {
      if (!isTelegramMessageGoneError(error)) {
        console.warn('loader-cleanup:delete-failed', {
          chatId,
          botKey,
          sessionId,
          reason,
          error: error?.telegramDescription || error?.message || String(error)
        });
      }
    }
  }

  await markLoaderStopped(chatId, botKey, sessionId, { clearMessageId: true });
  return true;
}

async function handleLoaderRotate(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const sessionId = normalizeLoaderSessionId(job.data?.sessionId);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !sessionId) continue;

    const waitingText = (job.data?.waitingText ?? '').toString();
    const shuffledMessages = shuffleLoaderMessages(
      Array.isArray(job.data?.messages)
        ? job.data.messages.map((value) => (value ?? '').toString()).filter((value) => value.trim())
        : []
    );

    let nextIndex = 0;
    let lastDisplayedText = waitingText;

    while (true) {
      const state = await fetchLoaderState(chatId, botKey);
      if (!state || state.session_id !== sessionId) break;

      const startedAtMs = state.started_at instanceof Date ? state.started_at.getTime() : NaN;
      const timedOut = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs >= LOADER_TIMEOUT_MS : false;
      if (state.stop_flag || timedOut) break;

      if (shuffledMessages.length > 0 && state.message_id) {
        const { text, nextIndex: computedNextIndex } = pickNextLoaderText(shuffledMessages, nextIndex, lastDisplayedText);
        nextIndex = computedNextIndex;
        if (text && text !== lastDisplayedText) {
          try {
            await editTelegramMessageText(chatId, state.message_id, text, { botKey });
            lastDisplayedText = text;
          } catch (error) {
            if (isTelegramNotModifiedError(error)) {
              lastDisplayedText = text;
            } else if (isTelegramMessageGoneError(error)) {
              await markLoaderStopped(chatId, botKey, sessionId, { clearMessageId: true });
              break;
            } else {
              console.warn('loader-rotate:edit-failed', {
                jobId: job.id,
                chatId,
                botKey,
                sessionId,
                error: error?.telegramDescription || error?.message || String(error)
              });
            }
          }
        }
      }

      await delay(LOADER_ROTATE_INTERVAL_MS);
    }

    await cleanupLoaderMessage({ chatId, botKey, sessionId, reason: 'rotate_exit' });
  }
}

async function handleLoaderTimeoutCleanup(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const sessionId = normalizeLoaderSessionId(job.data?.sessionId);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !sessionId) continue;

    await cleanupLoaderMessage({ chatId, botKey, sessionId, reason: 'timeout_cleanup' });
  }
}

async function handleOnboardingCompleteScan(jobs, boss) {
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

async function handleOnboardingCompleteSend(jobs) {
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
      const replyMarkup = buildOnboardingReplyMarkup(state, locale);
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

async function handleWinbackScan(jobs, boss) {
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

async function handleWinbackSend(jobs) {
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

async function handleBroadcastCampaignEnqueue(jobs, boss) {
  for (const job of jobs) {
    const campaignId = Number(job.data?.campaignId);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;

    try {
      await pool.query(
        `UPDATE broadcast_campaigns
            SET status = 'sending',
                started_at = COALESCE(started_at, NOW()),
                finished_at = NULL,
                error_text = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status IN ('queued', 'sending')`,
        [campaignId]
      );

      let offset = 0;
      while (true) {
        const recipients = await scanBroadcastRecipients(campaignId, env.broadcastProcessBatchSize, offset);
        if (recipients.length === 0) break;

        for (const recipient of recipients) {
          await enqueueBroadcastRecipientJob(boss, {
            campaignId,
            chatId: recipient.chatId,
            botKey: recipient.botKey
          });
        }

        if (recipients.length < env.broadcastProcessBatchSize) break;
        offset += recipients.length;
      }

      await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
      await finalizeBroadcastCampaignIfDone(campaignId);

      console.log('broadcast-campaign-enqueue', {
        jobId: job.id,
        campaignId
      });
    } catch (error) {
      const lastError = sanitizeErrorText(error?.message || String(error)) || 'broadcast_enqueue_failed';
      await refreshBroadcastCampaignStats(campaignId, {
        status: 'failed',
        errorText: lastError,
        setFinishedAt: true
      });
      console.error('broadcast-campaign-enqueue:failed', {
        jobId: job.id,
        campaignId,
        error: lastError
      });
      throw error;
    }
  }
}

async function handleBroadcastRecipientSend(jobs) {
  for (const job of jobs) {
    const campaignId = Number(job.data?.campaignId);
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) continue;

    const payload = await fetchBroadcastRecipientPayload(campaignId, chatId, botKey);
    if (!payload) continue;
    if (payload.recipient_status !== 'pending') continue;

    try {
      const messageText = (payload.message_text ?? '').toString();
      const messageKind = (payload.message_kind ?? 'text').toString().trim().toLowerCase();
      if (!BROADCAST_MESSAGE_KINDS.has(messageKind)) {
        throw new Error('bad_message_kind');
      }

      const mediaFileIdsByBot = normalizeBroadcastMediaFileIds(payload.media_file_ids);
      const mediaFileId = payload.media_file_id ? payload.media_file_id.toString() : null;
      const mediaUrl = payload.media_url ? payload.media_url.toString() : null;
      const replyMarkupResult = normalizeBroadcastReplyMarkup(payload.reply_markup);
      if (!replyMarkupResult.ok) {
        throw new Error(replyMarkupResult.error);
      }
      const replyMarkup = replyMarkupResult.replyMarkup;
      const telegramSafeText = sanitizeTelegramHtml(messageText);
      const mediaInput = mediaFileIdsByBot?.[botKey] || mediaFileId || mediaUrl || null;

      let telegramResult = null;
      if (messageKind === 'text') {
        telegramResult = await sendTelegramTextMessage(chatId, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      } else if (messageKind === 'photo') {
        if (!mediaInput) throw new Error('missing_media');
        telegramResult = await sendTelegramPhotoMessage(chatId, mediaInput, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      } else if (messageKind === 'video') {
        if (!mediaInput) throw new Error('missing_media');
        telegramResult = await sendTelegramVideoMessage(chatId, mediaInput, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      }

      const messageId = Number(telegramResult?.message_id ?? 0);
      const telegramMessageId = Number.isFinite(messageId) && messageId > 0 ? messageId : null;

      await updateBroadcastRecipient(campaignId, chatId, botKey, {
        status: 'sent',
        telegramMessageId,
        lastError: null
      });
      await updateUserDeliveryState(chatId, { status: 'sent', lastError: null, inactiveReason: null, botKey });
      await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
      await finalizeBroadcastCampaignIfDone(campaignId);

      console.log('broadcast-recipient-send:sent', {
        jobId: job.id,
        campaignId,
        chatId,
        botKey,
        telegramMessageId
      });
    } catch (error) {
      const lastError = sanitizeErrorText(error?.message || String(error)) || 'telegram_send_failed';
      const inactiveReason = classifyPermanentTelegramFailure(error);
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);

      if (inactiveReason || isFinalAttempt) {
        await updateBroadcastRecipient(campaignId, chatId, botKey, {
          status: 'failed',
          lastError
        });
        await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
        await finalizeBroadcastCampaignIfDone(campaignId);
      } else {
        await incrementBroadcastRecipientAttempt(campaignId, chatId, botKey, lastError);
      }

      await updateUserDeliveryState(chatId, {
        status: 'failed',
        lastError,
        inactiveReason,
        botKey
      });

      console.warn('broadcast-recipient-send:failed', {
        jobId: job.id,
        campaignId,
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

    if (env.broadcastPerMessageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.broadcastPerMessageDelayMs));
    }
  }
}

export async function registerWorkerHandlers(boss) {
  await boss.work(
    QUEUE_ONBOARDING_COMPLETE_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleOnboardingCompleteScan(jobs, boss)
  );

  await boss.work(
    QUEUE_ONBOARDING_COMPLETE_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleOnboardingCompleteSend
  );

  await boss.work(
    QUEUE_WINBACK_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleWinbackScan(jobs, boss)
  );

  for (let idx = 0; idx < WINBACK_SEND_CONCURRENCY; idx += 1) {
    await boss.work(
      QUEUE_WINBACK_SEND,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleWinbackSend
    );
  }

  await boss.work(
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleBroadcastCampaignEnqueue(jobs, boss)
  );

  for (let idx = 0; idx < LOADER_ROTATE_CONCURRENCY; idx += 1) {
    await boss.work(
      QUEUE_LOADER_ROTATE,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleLoaderRotate
    );
  }

  await boss.work(
    QUEUE_LOADER_TIMEOUT_CLEANUP,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleLoaderTimeoutCleanup
  );

  for (let idx = 0; idx < env.broadcastSendConcurrency; idx += 1) {
    await boss.work(
      QUEUE_BROADCAST_RECIPIENT_SEND,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleBroadcastRecipientSend
    );
  }
}

export async function getBroadcastAudiencePreview(filtersRaw, range, sampleLimit = 20) {
  const filters = normalizeBroadcastFilters(filtersRaw);
  const params = broadcastAudienceParams(filters, range);
  const countQuery = broadcastAudienceSql('COUNT(*)::int AS count');
  const sampleQuery = broadcastAudienceSql(
    `f.chat_id,
     f.username,
     f.first_name,
     f.bot_key,
     f.effective_tier,
     f.last_activity_at,
     f.streak_days,
     ROUND(f.usage_percent, 2)::numeric AS usage_percent,
     f.limit_reached`,
    'ORDER BY f.chat_id ASC, f.bot_key ASC LIMIT $13::int'
  );

  const [countRes, sampleRes] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(sampleQuery, [...params, sampleLimit])
  ]);

  return {
    filters,
    count: countRes.rows[0]?.count || 0,
    sample: sampleRes.rows || []
  };
}
