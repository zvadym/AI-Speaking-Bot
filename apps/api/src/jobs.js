import { createHash, randomUUID } from 'crypto';
import { env } from './env.js';
import { pool } from './db.js';
import { loadBotConfigs } from './bot-configs.js';
import { renderLlmPrompt } from './llm-prompts/index.js';
import { captureMessage } from './sentry.js';
import { sendDiscordEventNotification } from './discord-events.js';
import { createPublicBotCatalogLookup } from './shared/bot-catalog.js';
import {
  BROADCAST_MESSAGE_KINDS,
  broadcastAudienceParams,
  broadcastAudienceSql,
  normalizeBroadcastFilters,
  normalizeBroadcastMediaFileIds,
  normalizeBroadcastReplyMarkup
} from './shared/broadcast.js';
import {
  createTelegramClient,
  createTelegramDeliveryState,
  sanitizeErrorText,
  escapeTelegramHtmlText,
  normalizeBrokenTelegramTags,
  sanitizeTelegramHtml,
  normalizeTelegramParseMode,
  classifyPermanentTelegramFailure
} from './shared/telegram-delivery.js';
import {
  clampInteger,
  clampNumber,
  normalizeBotKey,
  normalizeLanguageCode,
  normalizeOptionalText,
  normalizeStringArray,
  parseChatIdList
} from './shared/normalization.js';
import {
  buildHourlyIdiomPracticeScheduleKey,
  buildIdiomPracticeScheduleKey,
  buildUtcDayRange,
  isCurrentIdiomPracticeScheduleKey,
  resolveIdiomPracticeLevelBucket
} from './idiom-phrases.js';
import {
  QUEUE_DAY1_RETURN_SCAN,
  QUEUE_DAY1_RETURN_SEND,
  QUEUE_WEEKLY_DIGEST_SCAN,
  QUEUE_WEEKLY_DIGEST_SEND,
  QUEUE_IDIOM_PRACTICE_SCAN,
  QUEUE_IDIOM_PRACTICE_SEND,
  QUEUE_FREE_LIMIT_HALF_SCAN,
  QUEUE_FREE_LIMIT_HALF_SEND,
  QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
  QUEUE_BROADCAST_RECIPIENT_SEND,
  QUEUE_DISCORD_EVENT_SEND,
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP,
  QUEUE_ONBOARDING_COMPLETE_SCAN,
  QUEUE_ONBOARDING_COMPLETE_SEND,
  QUEUE_WINBACK_SCAN,
  QUEUE_WINBACK_SEND,
  defaultRetryOptions
} from './queue.js';
import { createProgressService } from './bot-runtime/progress-service.js';
import { createLlmCallRecorder, observeLlmCall } from './bot-runtime/llm-telemetry.js';

const botConfigs = loadBotConfigs();
const recordLlmCall = createLlmCallRecorder(pool);
const ONBOARDING_TASK_TYPE = 'onboarding_complete';
const ONBOARDING_SCHEDULE_KEY = 'once';
const DAY1_RETURN_TASK_TYPE = 'day1_return';
const DAY1_RETURN_TEST_TASK_TYPE = 'day1_return_test';
const DAY1_RETURN_SCHEDULE_KEY = 'once';
const DAY1_RETURN_IDLE_HOURS = 22;
const DAY1_RETURN_SCAN_LIMIT = 500;
const DAY1_RETURN_MESSAGE_MAX_LEN = 180;
const DAY1_RETURN_MESSAGE_MAX_SENTENCES = 2;
const WEEKLY_DIGEST_TASK_TYPE = 'weekly_digest';
const WEEKLY_DIGEST_TEST_TASK_TYPE = 'weekly_digest_test';
const WEEKLY_DIGEST_SCAN_LIMIT = 500;
const WEEKLY_DIGEST_MESSAGE_MAX_LEN = 220;
const WEEKLY_DIGEST_MESSAGE_MAX_SENTENCES = 2;
const WEEKLY_DIGEST_MIN_PRACTICE_DAYS = 2;
const WEEKLY_DIGEST_RECENT_ACTIVITY_HOURS = 8;
const WEEKLY_DIGEST_SCAN_WEEKDAY = 1;
const WEEKLY_DIGEST_SCAN_HOUR_UTC = 16;
const IDIOM_PRACTICE_TASK_TYPE = 'idiom_phrase_practice';
const IDIOM_PRACTICE_TEST_TASK_TYPE = 'idiom_phrase_practice_test';
const IDIOM_PRACTICE_INITIAL_SEND_COUNT = 1;
const IDIOM_PRACTICE_DAILY_CAP = 3;
const IDIOM_PRACTICE_MORE_ACTION_TYPE = 'idiom_phrase_more_click';
const IDIOM_PRACTICE_MORE_XP_EVENT_TYPE = 'btn_idiom_more';
const IDIOM_PRACTICE_MORE_XP_AMOUNT = 2;
const FREE_LIMIT_HALF_TASK_TYPE = 'free_limit_50';
const FREE_LIMIT_HALF_TEST_TASK_TYPE = 'free_limit_50_test';
const FREE_LIMIT_HALF_SCAN_LIMIT = 500;
const WINBACK_SEND_CONCURRENCY = 3;
const WINBACK_SCAN_LIMIT = 500;
const WINBACK_MESSAGE_MAX_LEN = 220;
const WINBACK_MESSAGE_MAX_SENTENCES = 2;
const WINBACK_CONTEXT_TURN_LIMIT = 4;
const WINBACK_ADMIN_TEST_ORIGIN = 'admin_test';
const WINBACK_AUTOMATED_ORIGIN = 'automated';
const AUTOMATED_BEHAVIORAL_SUPPRESSION_TASK_TYPES = [
  DAY1_RETURN_TASK_TYPE,
  WEEKLY_DIGEST_TASK_TYPE,
  'winback_d3',
  'winback_d7',
  'winback_d14',
  FREE_LIMIT_HALF_TASK_TYPE
];
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
    maxHours: null,
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
const LOADER_ROTATE_CONCURRENCY = 10;
const DISCORD_EVENT_TYPES = new Set(['new_paid_user', 'user_milestone', 'user_feedback']);
const botCatalog = createPublicBotCatalogLookup(botConfigs, env.telegramBotTokensByBotKey || {});
const { metaForKey: publicBotMetaForKey } = botCatalog;
const idiomPracticeSupportedBotKeys = Object.values(botConfigs)
  .map((config) => normalizeBotKey(config?.bot_key))
  .filter((botKey) => {
    const meta = publicBotMetaForKey(botKey);
    return Boolean(botKey && (meta?.learning_language === 'en' || meta?.learning_language === 'de'));
  });
const telegramClient = createTelegramClient({
  env,
  fetchImpl: (...args) => fetch(...args)
});
const { updateUserDeliveryState } = createTelegramDeliveryState({ pool });
const {
  resolveTelegramBotToken,
  callTelegramApi,
  sendTelegramTextMessage,
  sendTelegramPhotoMessage,
  sendTelegramVideoMessage
} = telegramClient;

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

function resolveFreeLimitHalfTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? FREE_LIMIT_HALF_TEST_TASK_TYPE : FREE_LIMIT_HALF_TASK_TYPE;
}

function resolveDay1ReturnTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? DAY1_RETURN_TEST_TASK_TYPE : DAY1_RETURN_TASK_TYPE;
}

function resolveWeeklyDigestTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? WEEKLY_DIGEST_TEST_TASK_TYPE : WEEKLY_DIGEST_TASK_TYPE;
}

function resolveIdiomPracticeTaskType(origin = WINBACK_AUTOMATED_ORIGIN) {
  return origin === WINBACK_ADMIN_TEST_ORIGIN ? IDIOM_PRACTICE_TEST_TASK_TYPE : IDIOM_PRACTICE_TASK_TYPE;
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
  return `manual_test:${Date.now().toString(36)}:${randomUUID().replace(/-/g, '').slice(0, 8)}`;
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
    topic: [
      'Want to come back to "{{topic_title}}"? Write one short sentence — and we will continue.',
      'Want to return to "{{topic_title}}"? Write one short sentence — and we will continue.'
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

const FREE_LIMIT_HALF_DEFAULT_LOCALE = {
  message_html: '<b>You’re already halfway through your free limit ✨</b>\nIf you want to keep going, PRO costs less than 2 cups of coffee per month.\n\nIt unlocks extra features like new topics, tone settings, and more updates in the future.'
};

const DAY1_RETURN_DEFAULT_LOCALE = {
  text_variants: [
    'Ready for a 2-minute practice? Write one short sentence.',
    'Want to do a quick practice? Write one short sentence.'
  ],
  voice_variants: [
    'Ready for a quick practice? Send a short voice note.',
    'Want to get back into practice? Send a short voice note.'
  ],
  topic_text_variants: [
    'Want a quick restart with {{topic_title}}? Write one short sentence.',
    'Ready to jump back into {{topic_title}}? Write one short sentence.'
  ],
  topic_voice_variants: [
    'Want a quick restart with {{topic_title}}? Send a short voice note.',
    'Ready to jump back into {{topic_title}}? Send a short voice note.'
  ]
};

const WEEKLY_DIGEST_DEFAULT_LOCALE = {
  reply_cta_voice: 'send a short voice note',
  reply_cta_text: 'write one short sentence',
  default_variants: [
    'Last week: {{practice_days}} practice days, {{weekly_xp}} XP. {{reply_cta_label}} and let’s keep it going.',
    'You put in {{practice_days}} practice days and earned {{weekly_xp}} XP last week. {{reply_cta_label}} for a quick next step.'
  ],
  topic_variants: [
    'Last week: {{practice_days}} practice days, {{weekly_xp}} XP. Quick challenge on {{topic_title}}: {{reply_cta_label}}.',
    'You earned {{weekly_xp}} XP across {{practice_days}} practice days last week. Continue with {{topic_title}} by {{reply_cta_label}}.'
  ],
  streak_variants: [
    'Last week: {{practice_days}} practice days, {{weekly_xp}} XP, and your streak is at {{streak_current}}. {{reply_cta_label}} to build on it.',
    'You kept momentum last week: {{practice_days}} practice days, {{weekly_xp}} XP, streak {{streak_current}}. {{reply_cta_label}} and we’ll continue.'
  ]
};

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

function normalizeWinbackVariantArray(raw, fallback) {
  const next = Array.isArray(raw)
    ? raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return next.length ? next : fallback.slice();
}

function normalizeDay1ReturnVariantArray(raw, fallback) {
  const next = Array.isArray(raw)
    ? raw
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  return next.length ? next : fallback.slice();
}

function normalizeWeeklyDigestVariantArray(raw, fallback) {
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
    topic_text_variants: normalizeDay1ReturnVariantArray(raw.topic_text_variants, DAY1_RETURN_DEFAULT_LOCALE.topic_text_variants),
    topic_voice_variants: normalizeDay1ReturnVariantArray(raw.topic_voice_variants, DAY1_RETURN_DEFAULT_LOCALE.topic_voice_variants)
  };
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
    topic_variants: normalizeWeeklyDigestVariantArray(raw.topic_variants, WEEKLY_DIGEST_DEFAULT_LOCALE.topic_variants),
    streak_variants: normalizeWeeklyDigestVariantArray(raw.streak_variants, WEEKLY_DIGEST_DEFAULT_LOCALE.streak_variants)
  };
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
       COALESCE(ub.topic_enabled, false) AS topic_enabled,
       ub.topic_pack_json,
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
    topicEnabled: row.topic_enabled === true || row.topic_enabled === 1 || row.topic_enabled === 't',
    topicPackJson: normalizeTopicPack(row.topic_pack_json),
    topicTitle: extractTopicTitle(row.topic_pack_json),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    onboardingSentAt: origin === WINBACK_ADMIN_TEST_ORIGIN
      ? (row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null)
      : (row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null),
    locale: resolveDay1ReturnLocale(botKey)
  };
}

function pickDay1ReturnVariants(context) {
  if (context.topicEnabled && context.topicTitle) {
    return context.replyMode === WINBACK_REPLY_MODE_VOICE
      ? context.locale.topic_voice_variants
      : context.locale.topic_text_variants;
  }

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
    `${context.chatId}:${context.botKey}:${taskType}:${context.replyMode}:${context.topicTitle || ''}`,
    safeVariants.length
  );
  const template = safeVariants[variantIndex] || safeVariants[0];
  const messageText = applyTemplateSlots(template, {
    first_name: context.firstName,
    topic_title: context.topicTitle
  }).replace(/\s+/g, ' ').trim();
  const validation = validateDay1ReturnMessageText(messageText);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return {
    ok: true,
    messageText: validation.messageText,
    variantIndex,
    variantFamily: context.topicEnabled && context.topicTitle
      ? (context.replyMode === WINBACK_REPLY_MODE_VOICE ? 'topic_voice_variants' : 'topic_text_variants')
      : (context.replyMode === WINBACK_REPLY_MODE_VOICE ? 'voice_variants' : 'text_variants')
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
         COALESCE(SUM(e.xp_delta), 0)::int AS weekly_xp,
         (COUNT(DISTINCT ((e.occurred_at AT TIME ZONE 'UTC')::date))
           FILTER (WHERE COALESCE((e.meta->>'practice')::boolean, false)))::int AS practice_days
       FROM xp_events e
       WHERE e.chat_id = ub.chat_id
         AND e.bot_key = ub.bot_key
         AND e.occurred_at >= $1::timestamptz
         AND e.occurred_at < $2::timestamptz
     ) week_stats ON true
     WHERE COALESCE(ub.is_active, true) = true
       AND u.inactive_reason IS NULL
       AND ub.last_seen_at >= NOW() - interval '7 days'
       AND ub.last_seen_at <= NOW() - ($4::int * interval '1 hour')
       AND week_stats.weekly_xp > 0
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
       COALESCE(ub.topic_enabled, false) AS topic_enabled,
       ub.topic_pack_json,
       ub.last_seen_at,
       COALESCE(up.xp_total, 0)::int AS xp_total,
       COALESCE(up.streak_current, 0)::int AS streak_current,
       COALESCE(up.streak_best, 0)::int AS streak_best,
       COALESCE(us.profile_summary, '') AS profile_summary,
       COALESCE(us.short_summary, '') AS short_summary,
       onboarding.completed_at AS onboarding_sent_at,
       COALESCE(week_stats.weekly_xp, 0)::int AS weekly_xp,
       COALESCE(week_stats.practice_days, 0)::int AS practice_days
     FROM users u
     JOIN user_bots ub
       ON ub.chat_id = u.chat_id
     LEFT JOIN user_progress up
       ON up.chat_id = ub.chat_id
      AND up.bot_key = ub.bot_key
     LEFT JOIN user_summaries us
       ON us.chat_id = ub.chat_id
      AND us.bot_key = ub.bot_key
     LEFT JOIN bot_onboarding_completion onboarding
       ON onboarding.chat_id = ub.chat_id
      AND onboarding.bot_key = ub.bot_key
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(e.xp_delta), 0)::int AS weekly_xp,
         (COUNT(DISTINCT ((e.occurred_at AT TIME ZONE 'UTC')::date))
           FILTER (WHERE COALESCE((e.meta->>'practice')::boolean, false)))::int AS practice_days
       FROM xp_events e
       WHERE e.chat_id = ub.chat_id
         AND e.bot_key = ub.bot_key
         AND e.occurred_at >= $3::timestamptz
         AND e.occurred_at < $4::timestamptz
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
    topicEnabled: row.topic_enabled === true || row.topic_enabled === 1 || row.topic_enabled === 't',
    topicPackJson: normalizeTopicPack(row.topic_pack_json),
    topicTitle: extractTopicTitle(row.topic_pack_json),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    onboardingSentAt: row.onboarding_sent_at ? new Date(row.onboarding_sent_at) : null,
    xpTotal: clampInteger(row.xp_total, { min: 0, max: 10000000, fallback: 0 }),
    streakCurrent: clampInteger(row.streak_current, { min: 0, max: 100000, fallback: 0 }),
    streakBest: clampInteger(row.streak_best, { min: 0, max: 100000, fallback: 0 }),
    profileSummary: normalizeOptionalText(row.profile_summary, 2000) || '',
    shortSummary: normalizeOptionalText(row.short_summary, 1200) || '',
    weeklyXp: clampInteger(row.weekly_xp, { min: 0, max: 10000000, fallback: 0 }),
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
  if (context.topicEnabled && context.topicTitle) {
    return { family: 'topic_variants', variants: context.weeklyDigestLocale.topic_variants };
  }
  if (context.streakCurrent > 0) {
    return { family: 'streak_variants', variants: context.weeklyDigestLocale.streak_variants };
  }
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
  if (Number.isFinite(Number(context.weeklyXp)) && !value.includes(String(context.weeklyXp))) {
    return { ok: false, error: 'missing_weekly_xp_stat' };
  }
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
    topic_title: context.topicTitle,
    weekly_xp: context.weeklyXp,
    practice_days: context.practiceDays,
    streak_current: context.streakCurrent,
    streak_best: context.streakBest,
    reply_cta_label: context.replyCtaLabel
  }).replace(/\s+/g, ' ').trim();
  const validation = validateWeeklyDigestMessageText(messageText, context);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return {
    ok: true,
    messageText: validation.messageText,
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
      weekly_xp: context?.weeklyXp ?? null,
      practice_days: context?.practiceDays ?? null,
      streak_current: context?.streakCurrent ?? null,
      reply_mode: context?.replyMode || null,
      topic_enabled: Boolean(context?.topicEnabled),
      topic_title: context?.topicTitle || null,
      fallback_message_text: fallback?.messageText || null
    },
    level: 'warning'
  });
}

function extractResponseJsonSchemaCandidate(payloadJson) {
  if (!payloadJson || typeof payloadJson !== 'object') {
    return { text: '', source: 'none' };
  }

  const directOutputText = String(payloadJson.output_text || '').trim();
  if (directOutputText) {
    return { text: directOutputText, source: 'output_text' };
  }

  if (payloadJson.output_parsed && typeof payloadJson.output_parsed === 'object') {
    return {
      text: JSON.stringify(payloadJson.output_parsed),
      source: 'output_parsed'
    };
  }

  const outputItems = Array.isArray(payloadJson.output) ? payloadJson.output : [];
  for (const item of outputItems) {
    if (item?.parsed && typeof item.parsed === 'object') {
      return {
        text: JSON.stringify(item.parsed),
        source: 'output_item.parsed'
      };
    }

    const contentItems = Array.isArray(item?.content) ? item.content : [];
    for (const content of contentItems) {
      if (content?.parsed && typeof content.parsed === 'object') {
        return {
          text: JSON.stringify(content.parsed),
          source: `output_content.${String(content.type || 'parsed')}.parsed`
        };
      }

      const blockText = String(content?.text || content?.output_text || content?.value || '').trim();
      if (blockText) {
        return {
          text: blockText,
          source: `output_content.${String(content.type || 'text')}`
        };
      }
    }
  }

  return { text: '', source: 'empty' };
}

function parseResponseJsonSchemaPayload(payloadJson) {
  const candidate = extractResponseJsonSchemaCandidate(payloadJson);
  const outputText = String(candidate.text || '').trim();
  if (!outputText) {
    throw createAppError('openai_empty_output', 502, `openai_empty_output:${candidate.source}`, { retryable: false });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw createAppError('openai_invalid_json', 502, `openai_invalid_json:${candidate.source}`, { retryable: false });
  }

  return {
    parsed,
    outputSource: candidate.source
  };
}

async function requestReminderResponse({ context, operation, body }) {
  return observeLlmCall({
    trace: {
      chatId: context.chatId,
      botKey: context.botKey,
      route: operation
    },
    operation,
    model: env.reminderLlmModel,
    reasoningEffort: env.reminderLlmReasoningEffort,
    record: recordLlmCall,
    call: async () => {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, reasoning: { effort: env.reminderLlmReasoningEffort } })
      });

      let payloadJson = null;
      try {
        payloadJson = await response.json();
      } catch {
        payloadJson = null;
      }

      if (!response.ok) {
        const detail = sanitizeErrorText(payloadJson?.error?.message || `openai_http_${response.status}`)
          || `openai_http_${response.status}`;
        throw createAppError('openai_request_failed', 502, detail, { retryable: response.status >= 500 });
      }

      return payloadJson;
    }
  });
}

async function generateWeeklyDigestMessageWithLlm(context, taskType) {
  if (!env.openaiApiKey) {
    throw createAppError('missing_openai_api_key', 502, 'missing_openai_api_key', { retryable: false });
  }

  const systemPrompt = renderLlmPrompt('weekly-digest-system', {
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
      topic_enabled: context.topicEnabled,
      topic_title: context.topicTitle || null,
      profile_summary: context.profileSummary || null,
      short_summary: context.shortSummary || null,
      xp_total: context.xpTotal,
      streak_current: context.streakCurrent,
      streak_best: context.streakBest
    },
    progress: {
      weekly_xp: context.weeklyXp,
      practice_days: context.practiceDays
    },
    cta: {
      label: context.replyCtaLabel
    }
  };
  const userPrompt = renderLlmPrompt('weekly-digest-user', {
    context_json: JSON.stringify(payload, null, 2)
  });

  const payloadJson = await requestReminderResponse({
    context,
    operation: 'reminder.weekly_digest',
    body: {
      model: env.reminderLlmModel,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'weekly_digest_message',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              message_text: {
                type: 'string',
                minLength: 1,
                maxLength: WEEKLY_DIGEST_MESSAGE_MAX_LEN
              }
            },
            required: ['message_text'],
            additionalProperties: false
          }
        }
      }
    }
  });

  const { parsed, outputSource } = parseResponseJsonSchemaPayload(payloadJson);

  const validation = validateWeeklyDigestMessageText(String(parsed?.message_text || '').trim(), context);
  if (!validation.ok) {
    throw createAppError('weekly_digest_invalid_llm_output', 502, validation.error, { retryable: false });
  }

  return {
    messageText: validation.messageText,
    source: 'llm',
    outputSource,
    model: String(payloadJson?.model || env.reminderLlmModel || '').trim() || env.reminderLlmModel,
    responseId: String(payloadJson?.id || '').trim() || null,
    usage: payloadJson?.usage || null,
    taskType
  };
}

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
  if (context.weeklyXp <= 0) return { ok: false, code: 'no_weekly_xp', context };
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

  let generation = null;
  let generationError = null;
  try {
    generation = await generateWeeklyDigestMessageWithLlm(context, taskType);
  } catch (error) {
    generationError = sanitizeErrorText(error?.detail || error?.message || String(error)) || 'llm_generation_failed';
    generation = null;
  }

  if (!generation) {
    const fallback = buildWeeklyDigestFallbackMessage(context, taskType);
    if (!fallback.ok) {
      await finalizeScheduledDispatchAttempt(taskType, normalizedChatId, normalizedBotKey, effectiveScheduleKey, {
        status: 'failed',
        lastError: generationError || fallback.error || 'weekly_digest_build_failed',
        payloadJson: {
          origin,
          reminder_type: WEEKLY_DIGEST_TASK_TYPE,
          generation_error: generationError || fallback.error || 'weekly_digest_build_failed'
        }
      });
      throw createAppError(
        'weekly_digest_build_failed',
        502,
        generationError || fallback.error || 'weekly_digest_build_failed',
        { retryable: false }
      );
    }
    reportWeeklyDigestFallback(context, generationError, fallback, origin);
    generation = fallback;
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
        weekly_xp: context.weeklyXp,
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
         FROM xp_events e
         WHERE e.chat_id = ub.chat_id
           AND e.bot_key = ub.bot_key
           AND e.occurred_at >= $3::timestamptz
           AND e.occurred_at < $4::timestamptz
           AND COALESCE((e.meta->>'practice')::boolean, false)
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

async function grantIdiomPracticeMoreXp(client, {
  chatId,
  botKey,
  callbackQueryId,
  scheduleKey,
  sourceMessageId,
  deliveryIndex
}) {
  const normalizedChatId = Number(chatId);
  const normalizedBotKey = normalizeBotKey(botKey);
  const normalizedCallbackQueryId = String(callbackQueryId || '').trim();
  if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey || !normalizedCallbackQueryId) {
    return null;
  }

  const { rows } = await client.query(
    `SELECT *
       FROM public.grant_xp(
         $1::bigint,
         $2::text,
         $3::text,
         $4::int,
         $5::text,
         false,
         NOW(),
         $6::jsonb
       );`,
    [
      normalizedChatId,
      normalizedBotKey,
      IDIOM_PRACTICE_MORE_XP_EVENT_TYPE,
      IDIOM_PRACTICE_MORE_XP_AMOUNT,
      `xp:btn:idiom_more:${normalizedChatId}:${normalizedBotKey}:${normalizedCallbackQueryId}`,
      JSON.stringify({
        schedule_key: String(scheduleKey || '').trim() || null,
        callback_query_id: normalizedCallbackQueryId,
        source_message_id: Number.isFinite(Number(sourceMessageId)) ? Number(sourceMessageId) : null,
        delivery_index: Number.isFinite(Number(deliveryIndex)) ? Number(deliveryIndex) : null,
        source_group: 'idiom_more'
      })
    ]
  );

  return rows[0] || null;
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

    await grantIdiomPracticeMoreXp(client, {
      chatId: normalizedChatId,
      botKey: normalizedBotKey,
      callbackQueryId,
      scheduleKey: effectiveScheduleKey,
      sourceMessageId: telegramMessageId,
      deliveryIndex: deliveredCount + 1
    });

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
       COALESCE(us.profile_summary, '') AS profile_summary,
       COALESCE(us.short_summary, '') AS short_summary,
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
    profileSummary: normalizeOptionalText(row.profile_summary, 2000) || '',
    shortSummary: normalizeOptionalText(row.short_summary, 1200) || '',
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

async function hasRecentAutomatedBehavioralSuppression(chatId) {
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
  const systemPrompt = renderLlmPrompt('winback-system', {
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
      topic_enabled: context.topicEnabled,
      topic_title: context.topicTitle || null,
      profile_summary: context.profileSummary || null,
      short_summary: context.shortSummary || null,
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
  const userPrompt = renderLlmPrompt('winback-user', {
    context_json: JSON.stringify(payload, null, 2)
  });

  const payloadJson = await requestReminderResponse({
    context,
    operation: 'reminder.winback',
    body: {
      model: env.reminderLlmModel,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
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
    }
  });

  const { parsed, outputSource } = parseResponseJsonSchemaPayload(payloadJson);

  return {
    messageText: String(parsed?.message_text || '').trim(),
    source: 'llm',
    outputSource,
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

export async function enqueueDiscordEventNotificationJob(boss, event, { singletonKey } = {}) {
  if (!boss) return null;

  const type = String(event?.type || '').trim();
  if (!DISCORD_EVENT_TYPES.has(type)) return null;

  const sendOptions = {
    ...defaultRetryOptions()
  };
  if (singletonKey) {
    sendOptions.singletonKey = singletonKey;
  }

  return boss.send(QUEUE_DISCORD_EVENT_SEND, { ...event, type }, sendOptions);
}

async function handleLoaderRotate(jobs, progressService) {
  for (const job of jobs) {
    await progressService.rotate(job.data);
  }
}

async function handleLoaderTimeoutCleanup(jobs, progressService) {
  for (const job of jobs) {
    await progressService.timeout(job.data);
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

async function handleDay1ReturnScan(jobs, boss) {
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

async function handleDay1ReturnSend(jobs) {
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

async function handleWeeklyDigestScan(jobs, boss) {
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

async function handleIdiomPracticeScan(jobs, boss) {
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

async function handleWeeklyDigestSend(jobs) {
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

async function handleIdiomPracticeSend(jobs) {
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

async function handleFreeLimitHalfScan(jobs, boss) {
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

async function handleFreeLimitHalfSend(jobs) {
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

async function handleDiscordEventSend(jobs) {
  for (const job of jobs) {
    const event = job.data || {};
    const type = String(event?.type || '').trim();
    if (!DISCORD_EVENT_TYPES.has(type)) {
      continue;
    }

    const result = await sendDiscordEventNotification({
      webhookUrl: env.discordEventsWebhookUrl,
      event,
      botMetaForKey: publicBotMetaForKey
    });

    console.log('discord-event-send:sent', {
      jobId: job.id,
      type,
      executionId: event.execution_id || null,
      chatId: Number(event.chat_id || 0) || null,
      result: result?.ok === true ? 'ok' : 'skipped'
    });
  }
}

export async function registerWorkerHandlers(boss) {
  const progressService = createProgressService({ pool, boss, telegramClient });

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
    QUEUE_DAY1_RETURN_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleDay1ReturnScan(jobs, boss)
  );

  await boss.work(
    QUEUE_DAY1_RETURN_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleDay1ReturnSend
  );

  await boss.work(
    QUEUE_WEEKLY_DIGEST_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleWeeklyDigestScan(jobs, boss)
  );

  await boss.work(
    QUEUE_WEEKLY_DIGEST_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleWeeklyDigestSend
  );

  await boss.work(
    QUEUE_IDIOM_PRACTICE_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleIdiomPracticeScan(jobs, boss)
  );

  await boss.work(
    QUEUE_IDIOM_PRACTICE_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleIdiomPracticeSend
  );

  await boss.work(
    QUEUE_FREE_LIMIT_HALF_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleFreeLimitHalfScan(jobs, boss)
  );

  await boss.work(
    QUEUE_FREE_LIMIT_HALF_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleFreeLimitHalfSend
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
      (jobs) => handleLoaderRotate(jobs, progressService)
    );
  }

  await boss.work(
    QUEUE_LOADER_TIMEOUT_CLEANUP,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleLoaderTimeoutCleanup(jobs, progressService)
  );

  for (let idx = 0; idx < env.broadcastSendConcurrency; idx += 1) {
    await boss.work(
      QUEUE_BROADCAST_RECIPIENT_SEND,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleBroadcastRecipientSend
    );
  }

  await boss.work(
    QUEUE_DISCORD_EVENT_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleDiscordEventSend
  );
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
