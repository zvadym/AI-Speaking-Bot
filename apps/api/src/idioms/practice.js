import { botConfigs, publicBotMetaForKey, getBotLocale } from '../notifications/bot-context.js';
import { normalizeBotKey, normalizeOptionalText, clampInteger } from '../shared/normalization.js';
import {
  WINBACK_AUTOMATED_ORIGIN,
  WINBACK_ADMIN_TEST_ORIGIN,
  buildManualTestScheduleKey,
  isAutomatedMessageTestChatAllowed,
  hasRecentAutomatedBehavioralSuppression,
  automatedMessageTestChatIdsSqlParam,
  getAutomatedMessageTestState
} from '../notifications/policy.js';
import {
  buildUtcDayRange,
  isCurrentIdiomPracticeScheduleKey,
  resolveIdiomPracticeLevelBucket,
  buildHourlyIdiomPracticeScheduleKey,
  buildIdiomPracticeScheduleKey
} from './phrases.js';
import { pool } from '../db.js';
import { env } from '../env.js';
import {
  escapeTelegramHtmlText,
  sanitizeTelegramHtml,
  sanitizeErrorText,
  classifyPermanentTelegramFailure
} from '../shared/telegram-delivery.js';
import { createAppError } from '../core/errors.js';
import {
  hasSentScheduledDispatch,
  markScheduledDispatchAttemptStarted,
  finalizeScheduledDispatchAttempt
} from '../notifications/dispatch.js';
import {
  resolveTelegramBotToken,
  callTelegramApi,
  sendTelegramTextMessage,
  sendTelegramPhotoMessage,
  sendTelegramVideoMessage,
  updateUserDeliveryState
} from '../notifications/telegram.js';
import { QUEUE_IDIOM_PRACTICE_SEND, defaultRetryOptions } from '../queue.js';

const IDIOM_PRACTICE_TASK_TYPE = 'idiom_phrase_practice';

const IDIOM_PRACTICE_TEST_TASK_TYPE = 'idiom_phrase_practice_test';

const IDIOM_PRACTICE_INITIAL_SEND_COUNT = 1;

const IDIOM_PRACTICE_DAILY_CAP = 3;

const IDIOM_PRACTICE_MORE_ACTION_TYPE = 'idiom_phrase_more_click';

const idiomPracticeSupportedBotKeys = Object.values(botConfigs)
  .map((config) => normalizeBotKey(config?.bot_key))
  .filter((botKey) => {
    const meta = publicBotMetaForKey(botKey);
    return Boolean(botKey && (meta?.learning_language === 'en' || meta?.learning_language === 'de'));
  });

function resolveIdiomPracticeTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? IDIOM_PRACTICE_TEST_TASK_TYPE : IDIOM_PRACTICE_TASK_TYPE;
}

const IDIOM_PRACTICE_LOCALE_DEFAULTS = {
  default: {
    title: 'Daily idiomatic phrase practice',
    translation_label: 'Translation',
    meaning_label: 'Meaning',
    tone_label: 'Tone',
    example_label: 'Example',
    cta: 'Reply with this phrase in your own sentence.',
    more_button_text: 'Show one more phrase',
    more_sent: 'One more phrase is on the way.',
    more_limit_reached: 'You reached today\'s idiom limit.',
    more_expired: 'That idiom button has expired.'
  },
  ar: {
    title: 'ممارسة يومية للتعابير الاصطلاحية',
    translation_label: 'الترجمة',
    meaning_label: 'المعنى',
    tone_label: 'النبرة',
    example_label: 'مثال',
    cta: 'اكتب جملة من عندك باستخدام هذه العبارة.',
    more_button_text: 'اعرض عبارة أخرى',
    more_sent: 'سأرسل لك عبارة أخرى الآن.',
    more_limit_reached: 'لقد وصلت إلى حد التعابير الاصطلاحية لليوم.',
    more_expired: 'انتهت صلاحية زر التعابير الاصطلاحية هذا.'
  },
  de: {
    title: 'Taegliche Redewendungs-Praxis',
    translation_label: 'Uebersetzung',
    meaning_label: 'Bedeutung',
    tone_label: 'Ton',
    example_label: 'Beispiel',
    cta: 'Antworte mit einem eigenen Satz mit dieser Phrase.',
    more_button_text: 'Noch eine Phrase zeigen',
    more_sent: 'Noch eine Phrase ist unterwegs.',
    more_limit_reached: 'Du hast das heutige Redewendungs-Limit erreicht.',
    more_expired: 'Dieser Redewendungs-Button ist abgelaufen.'
  },
  en: {
    title: 'Daily idiomatic phrase practice',
    translation_label: 'Translation',
    meaning_label: 'Meaning',
    tone_label: 'Tone',
    example_label: 'Example',
    cta: 'Reply with this phrase in your own sentence.',
    more_button_text: 'Show one more phrase',
    more_sent: 'One more phrase is on the way.',
    more_limit_reached: 'You reached today\'s idiom limit.',
    more_expired: 'That idiom button has expired.'
  },
  hi: {
    title: 'रोज़ाना मुहावरेदार वाक्यांश अभ्यास',
    translation_label: 'अनुवाद',
    meaning_label: 'अर्थ',
    tone_label: 'लहजा',
    example_label: 'उदाहरण',
    cta: 'इस वाक्यांश का उपयोग करके अपना एक वाक्य लिखें।',
    more_button_text: 'एक और वाक्यांश दिखाएं',
    more_sent: 'मैं अभी एक और वाक्यांश भेज रहा हूँ।',
    more_limit_reached: 'आप आज की मुहावरेदार वाक्यांश सीमा तक पहुँच गए हैं।',
    more_expired: 'यह मुहावरेदार वाक्यांश बटन अब समाप्त हो चुका है।'
  },
  it: {
    title: 'Pratica quotidiana di espressioni idiomatiche',
    translation_label: 'Traduzione',
    meaning_label: 'Significato',
    tone_label: 'Tono',
    example_label: 'Esempio',
    cta: 'Rispondi con una tua frase usando questa espressione.',
    more_button_text: 'Mostra un\'altra espressione',
    more_sent: 'Ti mando un\'altra espressione.',
    more_limit_reached: 'Hai raggiunto il limite di oggi per le espressioni idiomatiche.',
    more_expired: 'Quel pulsante per le espressioni idiomatiche e scaduto.'
  },
  tr: {
    title: 'Gunluk deyim calismasi',
    translation_label: 'Ceviri',
    meaning_label: 'Anlam',
    tone_label: 'Ton',
    example_label: 'Ornek',
    cta: 'Bu ifadeyi kullanarak kendi cumleni yaz.',
    more_button_text: 'Bir ifade daha goster',
    more_sent: 'Sana hemen bir ifade daha gonderiyorum.',
    more_limit_reached: 'Bugunku deyim limitine ulastin.',
    more_expired: 'Bu deyim dugmesinin suresi doldu.'
  },
  uk: {
    title: 'Щоденна практика сталих фраз',
    translation_label: 'Переклад',
    meaning_label: 'Значення',
    tone_label: 'Тон',
    example_label: 'Приклад',
    cta: 'Надішли власне речення з цією фразою.',
    more_button_text: 'Покажи ще одну фразу',
    more_sent: 'Надсилаю ще одну фразу.',
    more_limit_reached: 'Ти вже використав сьогоднішній ліміт ідіом.',
    more_expired: 'Ця кнопка ідіом уже неактивна.'
  }
};

function resolveIdiomPracticeLocale(botKeyRaw) {
  const locale = getBotLocale(botKeyRaw);
  const notifications = locale.notifications && typeof locale.notifications === 'object' ? locale.notifications : {};
  const raw = notifications.idiom_phrase_practice && typeof notifications.idiom_phrase_practice === 'object'
    ? notifications.idiom_phrase_practice
    : {};
  const baseLanguage = publicBotMetaForKey(botKeyRaw)?.base_language || normalizeBotKey(botKeyRaw)?.split('-')?.[0] || '';
  const defaults = IDIOM_PRACTICE_LOCALE_DEFAULTS[baseLanguage] || IDIOM_PRACTICE_LOCALE_DEFAULTS.default;

  return {
    title: String(raw.title || defaults.title).trim() || defaults.title,
    translation_label: String(raw.translation_label || defaults.translation_label).trim() || defaults.translation_label,
    meaning_label: String(raw.meaning_label || defaults.meaning_label).trim() || defaults.meaning_label,
    tone_label: String(raw.tone_label || defaults.tone_label).trim() || defaults.tone_label,
    example_label: String(raw.example_label || defaults.example_label).trim() || defaults.example_label,
    cta: String(raw.cta || defaults.cta).trim() || defaults.cta,
    more_button_text: String(raw.more_button_text || defaults.more_button_text).trim() || defaults.more_button_text,
    more_sent: String(raw.more_sent || defaults.more_sent).trim() || defaults.more_sent,
    more_limit_reached: String(raw.more_limit_reached || defaults.more_limit_reached).trim() || defaults.more_limit_reached,
    more_expired: String(raw.more_expired || defaults.more_expired).trim() || defaults.more_expired
  };
}

async function loadIdiomPracticeContext(chatId, botKeyRaw, {
  scheduleKey = null,
  origin = WINBACK_AUTOMATED_ORIGIN,
  now = new Date()
} = {}) {
  const botKey = normalizeBotKey(botKeyRaw);
  const normalizedChatId = Number(chatId);
  const dayRange = buildUtcDayRange(now);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !botKey || !dayRange) return null;

  const { rows } = await pool.query(
    `SELECT
       u.chat_id,
       u.first_name,
       u.inactive_reason,
       ub.bot_key,
       COALESCE(ub.is_active, true) AS is_active,
       ub.level,
       onboarding.completed_at AS onboarding_sent_at,
       EXISTS (
         SELECT 1
         FROM messages e
         WHERE e.role = 'user'
           AND e.chat_id = ub.chat_id
           AND e.bot_key = ub.bot_key
           AND e.created_at >= $3::timestamptz
           AND e.created_at < $4::timestamptz
       ) AS practiced_today
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
      botKey,
      dayRange.start.toISOString(),
      dayRange.end.toISOString()
    ]
  );

  const row = rows[0];
  if (!row) return null;

  const botMeta = publicBotMetaForKey(botKey) || {};
  const baseLanguage = botMeta.base_language || normalizeBotKey(botKey)?.split('-')?.[0] || '';
  const targetLanguage = botMeta.learning_language || botMeta.target_lang || normalizeBotKey(botKey)?.split('-')?.[1] || '';
  const requestedScheduleKey = String(scheduleKey || '').trim();
  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (requestedScheduleKey || buildManualTestScheduleKey())
    : (isCurrentIdiomPracticeScheduleKey(requestedScheduleKey, now) ? requestedScheduleKey : dayRange.scheduleKey);

  return {
    chatId: normalizedChatId,
    botKey,
    firstName: normalizeOptionalText(row.first_name, 80) || '',
    inactiveReason: normalizeOptionalText(row.inactive_reason, 80),
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === 't',
    level: normalizeOptionalText(row.level, 16) || 'a1',
    levelBucket: resolveIdiomPracticeLevelBucket(row.level),
    onboardingSentAt: row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null,
    practicedToday: row.practiced_today === true || row.practiced_today === 1 || row.practiced_today === 't',
    baseLanguage,
    targetLanguage,
    scheduleKey: effectiveScheduleKey,
    dayStart: dayRange.start,
    dayEnd: dayRange.end,
    locale: resolveIdiomPracticeLocale(botKey)
  };
}

async function fetchScheduledDispatchId(taskType, chatId, botKey, scheduleKey) {
  const { rows } = await pool.query(
    `SELECT id
       FROM scheduled_task_dispatches
      WHERE task_type = $1
        AND bot_key = $2
        AND chat_id = $3
        AND schedule_key = $4
      LIMIT 1`,
    [taskType, botKey, chatId, scheduleKey]
  );
  const id = Number(rows[0]?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function findOrCreateScheduledDispatchForUpdate(client, {
  taskType,
  chatId,
  botKey,
  scheduleKey,
  payloadJson = {}
}) {
  const lookupResult = await client.query(
    `SELECT id, telegram_message_id, payload_json
       FROM scheduled_task_dispatches
      WHERE task_type = $1::text
        AND bot_key = $2::text
        AND chat_id = $3::bigint
        AND schedule_key = $4::text
      LIMIT 1
      FOR UPDATE`,
    [taskType, botKey, chatId, scheduleKey]
  );
  const existing = lookupResult.rows[0] || null;
  if (existing) return existing;

  const insertResult = await client.query(
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
       telegram_message_id,
       sent_at,
       created_at,
       updated_at
     )
     VALUES (
       $1::text,
       $2::text,
       $3::bigint,
       $4::text,
       'sent',
       NOW(),
       NULL,
       1,
       NULL,
       $5::jsonb,
       NULL,
       NOW(),
       NOW(),
       NOW()
     )
     ON CONFLICT (task_type, bot_key, chat_id, schedule_key) DO UPDATE
       SET updated_at = NOW()
     RETURNING id, telegram_message_id, payload_json`,
    [taskType, botKey, chatId, scheduleKey, JSON.stringify(payloadJson || {})]
  );
  return insertResult.rows[0] || null;
}

function normalizeIdiomPracticeDispatchPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function normalizeIdiomPracticeIdList(raw) {
  return Array.isArray(raw)
    ? raw
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
}

function buildIdiomPracticeReplyMarkup(context, scheduleKey, remainingCount) {
  const normalizedRemainingCount = clampInteger(remainingCount, {
    min: 0,
    max: IDIOM_PRACTICE_DAILY_CAP,
    fallback: 0
  });
  if (!scheduleKey || normalizedRemainingCount <= 0) return null;
  const locale = context.locale || resolveIdiomPracticeLocale(context.botKey);
  return {
    inline_keyboard: [[{
      text: String(locale.more_button_text || 'More').trim() || 'More',
      callback_data: `idiom_more:${scheduleKey}`
    }]]
  };
}

function buildIdiomPracticeDispatchPayload(currentPayload, { phraseIds = [], telegramMessageId = null } = {}) {
  const payload = normalizeIdiomPracticeDispatchPayload(currentPayload);
  const nextPhraseIds = Array.from(new Set([
    ...normalizeIdiomPracticeIdList(payload.phrase_ids),
    ...normalizeIdiomPracticeIdList(phraseIds)
  ]));
  const nextMessageIds = Array.from(new Set([
    ...normalizeIdiomPracticeIdList(payload.idiom_message_ids),
    ...normalizeIdiomPracticeIdList([telegramMessageId])
  ]));
  return {
    ...payload,
    phrase_ids: nextPhraseIds,
    idiom_message_ids: nextMessageIds,
    delivery_count: nextPhraseIds.length
  };
}

function isManualIdiomPracticeSchedule(scheduleKey) {
  return String(scheduleKey || '').trim().startsWith('manual_test:');
}

function isIdiomPracticeScheduleCurrent(scheduleKey, now = new Date()) {
  return isCurrentIdiomPracticeScheduleKey(scheduleKey, now);
}

function isInteractiveIdiomPracticeSchedule(scheduleKey, now = new Date()) {
  return isIdiomPracticeScheduleCurrent(scheduleKey, now) || isManualIdiomPracticeSchedule(scheduleKey);
}

function resolveIdiomPracticeInteractiveCap(scheduleKey, now = new Date()) {
  if (isManualIdiomPracticeSchedule(scheduleKey)) return IDIOM_PRACTICE_DAILY_CAP;
  const currentMinuteOfDay = now instanceof Date && Number.isFinite(now.getTime())
    ? (now.getUTCHours() * 60) + now.getUTCMinutes()
    : (24 * 60);
  const remainingAutomaticSlots = env.idiomPracticeSendHoursUtc.filter(
    (hour) => (hour * 60) + env.idiomPracticeSendMinuteUtc > currentMinuteOfDay
  ).length;
  return Math.max(IDIOM_PRACTICE_INITIAL_SEND_COUNT, IDIOM_PRACTICE_DAILY_CAP - remainingAutomaticSlots);
}

async function countIdiomPracticeDeliveriesInDay({ chatId, botKey, dayStart, dayEnd, db = pool }) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS delivery_count
       FROM idiom_phrase_deliveries
      WHERE chat_id = $1::bigint
        AND bot_key = $2::text
        AND sent_at >= $3::timestamptz
        AND sent_at < $4::timestamptz`,
    [chatId, botKey, dayStart.toISOString(), dayEnd.toISOString()]
  );
  return clampInteger(rows[0]?.delivery_count, { min: 0, max: IDIOM_PRACTICE_DAILY_CAP, fallback: 0 });
}

async function selectIdiomPracticeBundle({
  chatId,
  botKey,
  baseLanguage,
  targetLanguage,
  levelBucket,
  scheduleKey,
  dayStart = null,
  dayEnd = null,
  limit,
  db = pool
}) {
  const normalizedLimit = clampInteger(limit, { min: 1, max: 10, fallback: 1 });
  const useDayWindow = dayStart instanceof Date
    && !Number.isNaN(dayStart.getTime())
    && dayEnd instanceof Date
    && !Number.isNaN(dayEnd.getTime());
  const query = useDayWindow
    ? `WITH candidates AS (
         SELECT
           c.id,
           c.phrase_text,
           c.meaning_text,
           c.tone_text,
           c.example_text,
           t.phrase_translation,
           t.meaning_translation,
           t.tone_translation,
           t.example_translation,
           COUNT(d.id)::int AS delivery_count,
           MAX(d.sent_at) AS last_sent_at
         FROM idiom_phrase_catalog c
         LEFT JOIN idiom_phrase_translations t
           ON t.phrase_id = c.id
          AND t.base_language = $3::text
         LEFT JOIN idiom_phrase_deliveries d
           ON d.phrase_id = c.id
          AND d.chat_id = $1::bigint
          AND d.bot_key = $2::text
         WHERE c.target_language = $4::text
           AND c.level_bucket = $5::text
           AND c.is_active = true
           AND NOT EXISTS (
             SELECT 1
             FROM idiom_phrase_deliveries d_today
             WHERE d_today.chat_id = $1::bigint
               AND d_today.bot_key = $2::text
               AND d_today.sent_at >= $6::timestamptz
               AND d_today.sent_at < $7::timestamptz
               AND d_today.phrase_id = c.id
           )
         GROUP BY
           c.id,
           c.phrase_text,
           c.meaning_text,
           c.tone_text,
           c.example_text,
           t.phrase_translation,
           t.meaning_translation,
           t.tone_translation,
           t.example_translation
       )
       SELECT *
         FROM candidates
        ORDER BY
          delivery_count ASC,
          RANDOM(),
          id ASC
        LIMIT $8::int`
    : `WITH candidates AS (
         SELECT
           c.id,
           c.phrase_text,
           c.meaning_text,
           c.tone_text,
           c.example_text,
           t.phrase_translation,
           t.meaning_translation,
           t.tone_translation,
           t.example_translation,
           COUNT(d.id)::int AS delivery_count,
           MAX(d.sent_at) AS last_sent_at
         FROM idiom_phrase_catalog c
         LEFT JOIN idiom_phrase_translations t
           ON t.phrase_id = c.id
          AND t.base_language = $3::text
         LEFT JOIN idiom_phrase_deliveries d
           ON d.phrase_id = c.id
          AND d.chat_id = $1::bigint
          AND d.bot_key = $2::text
         WHERE c.target_language = $4::text
           AND c.level_bucket = $5::text
           AND c.is_active = true
           AND NOT EXISTS (
             SELECT 1
             FROM idiom_phrase_deliveries d_today
             WHERE d_today.chat_id = $1::bigint
               AND d_today.bot_key = $2::text
               AND d_today.schedule_key = $6::text
               AND d_today.phrase_id = c.id
           )
         GROUP BY
           c.id,
           c.phrase_text,
           c.meaning_text,
           c.tone_text,
           c.example_text,
           t.phrase_translation,
           t.meaning_translation,
           t.tone_translation,
           t.example_translation
       )
       SELECT *
         FROM candidates
        ORDER BY
          delivery_count ASC,
          RANDOM(),
          id ASC
        LIMIT $7::int`;
  const params = useDayWindow
    ? [
        chatId,
        botKey,
        baseLanguage,
        targetLanguage,
        levelBucket,
        dayStart.toISOString(),
        dayEnd.toISOString(),
        normalizedLimit
      ]
    : [chatId, botKey, baseLanguage, targetLanguage, levelBucket, scheduleKey, normalizedLimit];
  const { rows } = await db.query(query, params);

  return (rows || []).map((row) => ({
    id: Number(row.id),
    phraseText: String(row.phrase_text || '').trim(),
    meaningText: String(row.meaning_text || '').trim(),
    toneText: String(row.tone_text || '').trim(),
    exampleText: String(row.example_text || '').trim(),
    phraseTranslation: String(row.phrase_translation || '').trim(),
    meaningTranslation: String(row.meaning_translation || '').trim(),
    toneTranslation: String(row.tone_translation || '').trim(),
    exampleTranslation: String(row.example_translation || '').trim(),
    deliveryCount: clampInteger(row.delivery_count, { min: 0, max: 1000000, fallback: 0 }),
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at) : null
  }));
}

function buildIdiomPracticeMessage(context, phrase) {
  if (!phrase || typeof phrase !== 'object') return '';
  const locale = context.locale || resolveIdiomPracticeLocale(context.botKey);
  const parts = [`<b>${escapeTelegramHtmlText(locale.title)}</b>`];
  parts.push('');
  parts.push(`<b>${escapeTelegramHtmlText(phrase.phraseText)}</b>`);
  parts.push(`🗣 ${escapeTelegramHtmlText(phrase.phraseTranslation)}`);
  parts.push(`💡 ${escapeTelegramHtmlText(phrase.meaningTranslation)}`);
  parts.push(`🎭 ${escapeTelegramHtmlText(locale.tone_label)}: ${escapeTelegramHtmlText(phrase.toneTranslation)}`);
  parts.push('');
  parts.push(`📝 ${escapeTelegramHtmlText(locale.example_label)}: ${escapeTelegramHtmlText(phrase.exampleText)}`);
  parts.push(`<i>(${escapeTelegramHtmlText(phrase.exampleTranslation)})</i>`);

  parts.push('');
  parts.push(escapeTelegramHtmlText(locale.cta));
  return parts.join('\n');
}

async function insertIdiomPhraseDeliveries({
  taskDispatchId,
  chatId,
  botKey,
  scheduleKey,
  levelBucket,
  phraseIds,
  db = pool
}) {
  const normalizedIds = Array.isArray(phraseIds)
    ? phraseIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (!normalizedIds.length) return;

  await db.query(
    `INSERT INTO idiom_phrase_deliveries (
       task_dispatch_id,
       chat_id,
       bot_key,
       phrase_id,
       schedule_key,
       level_bucket,
       sent_at,
       created_at
     )
     SELECT
       $1::bigint,
       $2::bigint,
       $3::text,
       UNNEST($4::bigint[]),
       $5::text,
       $6::text,
       NOW(),
       NOW()`,
    [taskDispatchId, chatId, botKey, normalizedIds, scheduleKey, levelBucket]
  );
}

async function evaluateIdiomPracticeEligibility({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  scheduleKey = null,
  now = new Date()
}) {
  if (!isAutomatedMessageTestChatAllowed(chatId)) {
    throw createAppError('chat_not_allowed_in_test_mode', 403, 'chat_not_allowed_in_test_mode', { retryable: false });
  }

  const context = await loadIdiomPracticeContext(chatId, botKey, { origin, scheduleKey, now });
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
  if (await hasSentScheduledDispatch(IDIOM_PRACTICE_TASK_TYPE, context.chatId, context.botKey, context.scheduleKey)) {
    return { ok: false, code: 'already_sent', context };
  }

  const suppression = await hasRecentAutomatedBehavioralSuppression(context.chatId);
  if (suppression.suppressed) {
    return { ok: false, code: suppression.code, context };
  }

  return { ok: true, code: null, context };
}

async function scanEligibleIdiomPracticeUsers(now = new Date()) {
  const testChatIds = automatedMessageTestChatIdsSqlParam();
  const dayRange = buildUtcDayRange(now);
  const scheduleKey = buildHourlyIdiomPracticeScheduleKey(now);
  if (!dayRange || !scheduleKey) return [];

  const { rows } = await pool.query(
    `SELECT
       ub.chat_id,
       ub.bot_key,
       ub.level
     FROM user_bots ub
     JOIN users u
       ON u.chat_id = ub.chat_id
     WHERE COALESCE(ub.is_active, true) = true
       AND u.inactive_reason IS NULL
       AND ub.bot_key = ANY($1::text[])
       AND ($2::bigint[] IS NULL OR ub.chat_id = ANY($2::bigint[]))
       AND NOT EXISTS (
         SELECT 1
         FROM scheduled_task_dispatches std
         WHERE std.task_type = $3::text
           AND std.bot_key = ub.bot_key
           AND std.chat_id = ub.chat_id
           AND std.schedule_key = $4::text
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       )
     ORDER BY ub.chat_id ASC, ub.bot_key ASC
     LIMIT $5::int`,
    [
      idiomPracticeSupportedBotKeys,
      testChatIds,
      IDIOM_PRACTICE_TASK_TYPE,
      scheduleKey,
      env.idiomPracticeScanLimit
    ]
  );

  return (rows || []).map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key),
    level: normalizeOptionalText(row.level, 16) || 'a1',
    taskType: IDIOM_PRACTICE_TASK_TYPE,
    scheduleKey
  })).filter((row) => Number.isFinite(row.chatId) && row.chatId > 0 && row.botKey);
}

export async function sendIdiomPracticeReminderCore({
  chatId,
  botKey,
  origin = WINBACK_AUTOMATED_ORIGIN,
  taskType = resolveIdiomPracticeTaskType(origin),
  scheduleKey = null,
  now = new Date()
} = {}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const requestedScheduleKey = String(scheduleKey || '').trim();
  const dayScheduleKey = buildIdiomPracticeScheduleKey(now);
  const effectiveScheduleKey = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? (requestedScheduleKey || buildManualTestScheduleKey())
    : (isCurrentIdiomPracticeScheduleKey(requestedScheduleKey, now) ? requestedScheduleKey : dayScheduleKey);

  const eligibility = await evaluateIdiomPracticeEligibility({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    origin,
    scheduleKey: effectiveScheduleKey,
    now
  });

  if (!eligibility.ok) {
    await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      origin,
      reminder_type: IDIOM_PRACTICE_TASK_TYPE
    });
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: eligibility.code,
      payloadJson: {
        origin,
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
        skipped_reason: eligibility.code
      }
    });
    return null;
  }

  const context = eligibility.context;
  await markScheduledDispatchAttemptStarted(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
    origin,
    reminder_type: IDIOM_PRACTICE_TASK_TYPE,
    level_bucket: context.levelBucket
  });

  const taskDispatchId = await fetchScheduledDispatchId(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey);
  const deliveredToday = origin === WINBACK_ADMIN_TEST_ORIGIN
    ? 0
    : await countIdiomPracticeDeliveriesInDay({
        chatId: normalizedChatId,
        botKey: normalizedBotKey,
        dayStart: context.dayStart,
        dayEnd: context.dayEnd
      });
  const phrases = await selectIdiomPracticeBundle({
    chatId: normalizedChatId,
    botKey: normalizedBotKey,
    baseLanguage: context.baseLanguage,
    targetLanguage: context.targetLanguage,
    levelBucket: context.levelBucket,
    scheduleKey: effectiveScheduleKey,
    dayStart: origin === WINBACK_ADMIN_TEST_ORIGIN ? null : context.dayStart,
    dayEnd: origin === WINBACK_ADMIN_TEST_ORIGIN ? null : context.dayEnd,
    limit: IDIOM_PRACTICE_INITIAL_SEND_COUNT
  });

  if (phrases.length < IDIOM_PRACTICE_INITIAL_SEND_COUNT) {
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: 'insufficient_phrase_catalog',
      payloadJson: {
        origin,
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
        level_bucket: context.levelBucket,
        phrase_count: phrases.length
      }
    });
    throw createAppError('insufficient_phrase_catalog', 502, 'insufficient_phrase_catalog', { retryable: false });
  }

  const phrase = phrases[0] || null;
  if (!phrase?.phraseTranslation || !phrase?.meaningTranslation || !phrase?.toneTranslation || !phrase?.exampleTranslation) {
    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'failed',
      lastError: 'missing_phrase_translation',
      payloadJson: {
        origin,
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
        phrase_id: phrase?.id || null
      }
    });
    throw createAppError('missing_phrase_translation', 502, 'missing_phrase_translation', { retryable: false });
  }

  const messageText = buildIdiomPracticeMessage(context, phrase);
  if (!messageText) {
    throw createAppError('idiom_phrase_build_failed', 502, 'idiom_phrase_build_failed', { retryable: false });
  }

  try {
    const interactiveCap = resolveIdiomPracticeInteractiveCap(effectiveScheduleKey, now);
    const remainingInteractiveCount = interactiveCap - (deliveredToday + IDIOM_PRACTICE_INITIAL_SEND_COUNT);
    const replyMarkup = isInteractiveIdiomPracticeSchedule(effectiveScheduleKey, now)
      ? buildIdiomPracticeReplyMarkup(context, effectiveScheduleKey, remainingInteractiveCount)
      : null;
    const telegramResult = await sendTelegramTextMessage(normalizedChatId, sanitizeTelegramHtml(messageText), {
      botKey: normalizedBotKey,
      parseMode: 'HTML',
      replyMarkup
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;
    const dispatchPayload = buildIdiomPracticeDispatchPayload({}, {
      phraseIds: [phrase.id],
      telegramMessageId
    });

    await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
      status: 'sent',
      telegramMessageId,
      payloadJson: {
        origin,
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
        level_bucket: context.levelBucket,
        message_text: messageText,
        ...dispatchPayload
      }
    });
    if (taskDispatchId) {
      await insertIdiomPhraseDeliveries({
        taskDispatchId,
        chatId: normalizedChatId,
        botKey: normalizedBotKey,
        scheduleKey: effectiveScheduleKey,
        levelBucket: context.levelBucket,
        phraseIds: [phrase.id]
      });
    }
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
      messageText,
      phraseIds: [phrase.id],
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
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
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

async function reserveIdiomPracticeMoreClickEvent(client, {
  chatId,
  botKey,
  callbackQueryId,
  scheduleKey,
  sourceMessageId
}) {
  const idempotencyKey = String(callbackQueryId || '').trim()
    ? `idiom_phrase_more_click:${String(callbackQueryId).trim()}`
    : null;
  if (!idempotencyKey) return { idempotencyKey: null, inserted: true };

  const { rowCount } = await client.query(
    `INSERT INTO action_events (
       chat_id,
       bot_key,
       action_type,
       source,
       idempotency_key,
       properties,
       occurred_at
     )
     VALUES (
       $1::bigint,
       $2::text,
       $3::text,
       'worker',
       $4::text,
       $5::jsonb,
       NOW()
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      chatId,
      botKey,
      IDIOM_PRACTICE_MORE_ACTION_TYPE,
      idempotencyKey,
      JSON.stringify({
        schedule_key: scheduleKey,
        source_message_id: Number.isFinite(Number(sourceMessageId)) ? Number(sourceMessageId) : null,
        callback_query_id: String(callbackQueryId || '').trim() || null,
        result: 'processing'
      })
    ]
  );

  return { idempotencyKey, inserted: rowCount > 0 };
}

async function finalizeIdiomPracticeMoreClickEvent(client, idempotencyKey, properties) {
  if (!idempotencyKey) return;
  await client.query(
    `UPDATE action_events
        SET properties = $2::jsonb,
            occurred_at = NOW()
      WHERE idempotency_key = $1::text`,
    [idempotencyKey, JSON.stringify(properties || {})]
  );
}

async function recordIdiomPracticeMoreClickOutcome(db, {
  chatId,
  botKey,
  callbackQueryId,
  scheduleKey,
  sourceMessageId,
  result,
  deliveryIndex = null
}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  const idempotencyKey = String(callbackQueryId || '').trim()
    ? `idiom_phrase_more_click:${String(callbackQueryId).trim()}`
    : null;
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey || !idempotencyKey) return;

  await db.query(
    `INSERT INTO action_events (
       chat_id,
       bot_key,
       action_type,
       source,
       idempotency_key,
       properties,
       occurred_at
     )
     VALUES (
       $1::bigint,
       $2::text,
       $3::text,
       'worker',
       $4::text,
       $5::jsonb,
       NOW()
     )
     ON CONFLICT (idempotency_key) DO UPDATE
       SET properties = EXCLUDED.properties,
           occurred_at = EXCLUDED.occurred_at`,
    [
      normalizedChatId,
      normalizedBotKey,
      IDIOM_PRACTICE_MORE_ACTION_TYPE,
      idempotencyKey,
      JSON.stringify({
        schedule_key: String(scheduleKey || '').trim() || null,
        source_message_id: Number.isFinite(Number(sourceMessageId)) ? Number(sourceMessageId) : null,
        callback_query_id: String(callbackQueryId || '').trim() || null,
        result: String(result || '').trim() || null,
        delivery_index: Number.isFinite(Number(deliveryIndex)) ? Number(deliveryIndex) : null
      })
    ]
  );
}

export async function sendIdiomPracticeMorePhrase({
  chatId,
  botKey,
  scheduleKey,
  callbackQueryId,
  sourceMessageId = null,
  now = new Date()
} = {}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  const normalizedScheduleKey = String(scheduleKey || '').trim();
  const normalizedSourceMessageId = Number(sourceMessageId);
  const locale = resolveIdiomPracticeLocale(normalizedBotKey);
  const isManualRequest = isManualIdiomPracticeSchedule(normalizedScheduleKey);

  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey || !normalizedScheduleKey || !String(callbackQueryId || '').trim()) {
    throw createAppError('bad_request', 400, 'bad_request', { retryable: false });
  }

  const context = await loadIdiomPracticeContext(normalizedChatId, normalizedBotKey, {
    origin: isManualRequest ? WINBACK_ADMIN_TEST_ORIGIN : WINBACK_AUTOMATED_ORIGIN,
    scheduleKey: isManualRequest || isIdiomPracticeScheduleCurrent(normalizedScheduleKey, now)
      ? normalizedScheduleKey
      : null,
    now
  });
  if (!context) {
    await recordIdiomPracticeMoreClickOutcome(pool, {
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      callbackQueryId,
      scheduleKey: normalizedScheduleKey,
      sourceMessageId: normalizedSourceMessageId,
      result: 'no_dispatch'
    });
    return {
      ok: true,
      status: 'no_dispatch',
      callbackText: locale.more_expired,
      deliveryIndex: null,
      telegramMessageId: null
    };
  }
  const effectiveScheduleKey = context.scheduleKey;
  const dispatchTaskType = isManualRequest ? IDIOM_PRACTICE_TEST_TASK_TYPE : IDIOM_PRACTICE_TASK_TYPE;

  const client = await pool.connect();
  let reservedEventKey = null;

  try {
    await client.query('BEGIN');

    const reserve = await reserveIdiomPracticeMoreClickEvent(client, {
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      callbackQueryId,
      scheduleKey: effectiveScheduleKey,
      sourceMessageId: normalizedSourceMessageId
    });
    reservedEventKey = reserve.idempotencyKey;
    if (!reserve.inserted) {
      await client.query('ROLLBACK');
      return {
        ok: true,
        status: 'limit_reached',
        callbackText: locale.more_limit_reached,
        deliveryIndex: null,
        telegramMessageId: null
      };
    }

    const dispatch = await findOrCreateScheduledDispatchForUpdate(client, {
      taskType: dispatchTaskType,
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      scheduleKey: effectiveScheduleKey,
      payloadJson: {
        reminder_type: IDIOM_PRACTICE_TASK_TYPE,
        level_bucket: context.levelBucket
      }
    });
    const dispatchPayload = normalizeIdiomPracticeDispatchPayload(dispatch?.payload_json);
    const baseEventProperties = {
      schedule_key: effectiveScheduleKey,
      requested_schedule_key: normalizedScheduleKey || null,
      source_message_id: Number.isFinite(normalizedSourceMessageId) && normalizedSourceMessageId > 0 ? normalizedSourceMessageId : null,
      callback_query_id: String(callbackQueryId || '').trim() || null
    };

    if (!dispatch) {
      await finalizeIdiomPracticeMoreClickEvent(client, reservedEventKey, {
        ...baseEventProperties,
        result: 'no_dispatch'
      });
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'no_dispatch',
        callbackText: context.locale.more_expired,
        deliveryIndex: null,
        telegramMessageId: null
      };
    }

    const deliveriesResult = await client.query(
      isManualRequest
        ? `SELECT COUNT(*)::int AS delivery_count
             FROM idiom_phrase_deliveries
            WHERE task_dispatch_id = $1::bigint`
        : `SELECT COUNT(*)::int AS delivery_count
             FROM idiom_phrase_deliveries
            WHERE chat_id = $1::bigint
              AND bot_key = $2::text
              AND sent_at >= $3::timestamptz
              AND sent_at < $4::timestamptz`,
      isManualRequest
        ? [dispatch.id]
        : [
            normalizedChatId,
            normalizedBotKey,
            context.dayStart.toISOString(),
            context.dayEnd.toISOString()
          ]
    );
    const deliveredCount = clampInteger(deliveriesResult.rows[0]?.delivery_count, {
      min: 0,
      max: IDIOM_PRACTICE_DAILY_CAP,
      fallback: 0
    });
    const interactiveCap = resolveIdiomPracticeInteractiveCap(effectiveScheduleKey, now);

    if (deliveredCount >= interactiveCap) {
      const telegramResult = await sendTelegramTextMessage(
        normalizedChatId,
        sanitizeTelegramHtml(String(context.locale.more_limit_reached || locale.more_limit_reached || '')),
        {
          botKey: normalizedBotKey,
          parseMode: 'HTML'
        }
      );
      const limitMessageIdRaw = Number(telegramResult?.message_id ?? 0);
      const limitTelegramMessageId = Number.isFinite(limitMessageIdRaw) && limitMessageIdRaw > 0 ? limitMessageIdRaw : null;
      await finalizeIdiomPracticeMoreClickEvent(client, reservedEventKey, {
        ...baseEventProperties,
        result: 'limit_reached'
      });
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'limit_reached',
        callbackText: '',
        deliveryIndex: null,
        telegramMessageId: limitTelegramMessageId
      };
    }

    const phrases = await selectIdiomPracticeBundle({
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      baseLanguage: context.baseLanguage,
      targetLanguage: context.targetLanguage,
      levelBucket: context.levelBucket,
      scheduleKey: effectiveScheduleKey,
      dayStart: isManualRequest ? null : context.dayStart,
      dayEnd: isManualRequest ? null : context.dayEnd,
      limit: 1,
      db: client
    });
    const phrase = phrases[0] || null;
    if (!phrase?.phraseTranslation || !phrase?.meaningTranslation || !phrase?.toneTranslation || !phrase?.exampleTranslation) {
      const telegramResult = await sendTelegramTextMessage(
        normalizedChatId,
        sanitizeTelegramHtml(String(context.locale.more_limit_reached || locale.more_limit_reached || '')),
        {
          botKey: normalizedBotKey,
          parseMode: 'HTML'
        }
      );
      const limitMessageIdRaw = Number(telegramResult?.message_id ?? 0);
      const limitTelegramMessageId = Number.isFinite(limitMessageIdRaw) && limitMessageIdRaw > 0 ? limitMessageIdRaw : null;
      await finalizeIdiomPracticeMoreClickEvent(client, reservedEventKey, {
        ...baseEventProperties,
        result: 'limit_reached'
      });
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'limit_reached',
        callbackText: '',
        deliveryIndex: null,
        telegramMessageId: limitTelegramMessageId
      };
    }

    const messageText = buildIdiomPracticeMessage(context, phrase);
    if (!messageText) {
      throw createAppError('idiom_phrase_build_failed', 502, 'idiom_phrase_build_failed', { retryable: false });
    }

    const remainingAfterSend = interactiveCap - (deliveredCount + 1);
    const replyMarkup = buildIdiomPracticeReplyMarkup(context, effectiveScheduleKey, remainingAfterSend);
    const telegramResult = await sendTelegramTextMessage(normalizedChatId, sanitizeTelegramHtml(messageText), {
      botKey: normalizedBotKey,
      parseMode: 'HTML',
      replyMarkup
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;

    await insertIdiomPhraseDeliveries({
      taskDispatchId: Number(dispatch.id),
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      scheduleKey: effectiveScheduleKey,
      levelBucket: context.levelBucket,
      phraseIds: [phrase.id],
      db: client
    });

    const nextPayload = buildIdiomPracticeDispatchPayload(dispatchPayload, {
      phraseIds: [phrase.id],
      telegramMessageId
    });
    await client.query(
      `UPDATE scheduled_task_dispatches
          SET payload_json = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1::bigint`,
      [dispatch.id, JSON.stringify(nextPayload)]
    );

    await finalizeIdiomPracticeMoreClickEvent(client, reservedEventKey, {
      ...baseEventProperties,
      result: 'delivered',
      delivery_index: deliveredCount + 1
    });

    await client.query('COMMIT');
    return {
      ok: true,
      status: 'delivered',
      callbackText: context.locale.more_sent,
      deliveryIndex: deliveredCount + 1,
      telegramMessageId
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures from a broken client session.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function sendAdminTestIdiomPracticeReminder({ chatId, botKey }) {
  const result = await sendIdiomPracticeReminderCore({
    chatId,
    botKey,
    origin: WINBACK_ADMIN_TEST_ORIGIN,
    taskType: resolveIdiomPracticeTaskType(WINBACK_ADMIN_TEST_ORIGIN),
    scheduleKey: buildManualTestScheduleKey()
  });

  if (!result) {
    throw createAppError('idiom_phrase_send_failed', 502, 'idiom_phrase_send_failed', { retryable: false });
  }

  return {
    ok: true,
    chat_id: result.chatId,
    bot_key: result.botKey,
    reminder_type: IDIOM_PRACTICE_TASK_TYPE,
    telegram_message_id: result.telegramMessageId,
    message_text: result.messageText,
    phrase_ids: result.phraseIds,
    allowlist_active: result.allowlistActive,
    task_type: result.taskType,
    schedule_key: result.scheduleKey
  };
}

async function enqueueIdiomPracticeSend(
  boss,
  { chatId, botKey, scheduleKey, taskType = IDIOM_PRACTICE_TASK_TYPE }
) {
  return boss.send(
    QUEUE_IDIOM_PRACTICE_SEND,
    { chatId, botKey, scheduleKey, taskType },
    {
      ...defaultRetryOptions(),
      singletonKey: `idiom_practice:${taskType}:${botKey}:${chatId}:${scheduleKey}`
    }
  );
}

export async function handleIdiomPracticeScan(jobs, boss) {
  for (const job of jobs) {
    const eligibleUsers = await scanEligibleIdiomPracticeUsers();
    console.log('idiom-practice-scan', {
      jobId: job.id,
      eligibleCount: eligibleUsers.length
    });

    for (const user of eligibleUsers) {
      await enqueueIdiomPracticeSend(boss, user);
    }
  }
}

export async function handleIdiomPracticeSend(jobs) {
  for (const job of jobs) {
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    const taskType = String(job.data?.taskType || '').trim() || IDIOM_PRACTICE_TASK_TYPE;
    const scheduleKey = String(job.data?.scheduleKey || '').trim();
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !scheduleKey) {
      continue;
    }

    try {
      const result = await sendIdiomPracticeReminderCore({
        chatId,
        botKey,
        origin: WINBACK_AUTOMATED_ORIGIN,
        taskType,
        scheduleKey
      });

      if (!result) {
        console.log('idiom-practice-send:skipped', {
          jobId: job.id,
          chatId,
          botKey,
          scheduleKey
        });
        continue;
      }

      console.log('idiom-practice-send:sent', {
        jobId: job.id,
        chatId,
        botKey,
        taskType,
        telegramMessageId: result.telegramMessageId,
        phraseIds: result.phraseIds
      });
    } catch (error) {
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);
      const detail = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'idiom_phrase_send_failed';

      console.warn('idiom-practice-send:failed', {
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
