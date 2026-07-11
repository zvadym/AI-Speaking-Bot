import 'dotenv/config';
import { extractBotTokens } from './bot-configs.js';
import { parseBotRuntimeRouteFlags } from './bot-runtime/route-flags.js';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalJsonObject(name) {
  const raw = process.env[name];
  if (!raw) return {};
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in env var: ${name}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in env var: ${name}`);
  }
  const obj = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalizedKey = String(key).trim().toLowerCase();
    if (!normalizedKey) continue;
    obj[normalizedKey] = value;
  }
  return obj;
}

function optionalUrl(name) {
  const value = process.env[name];
  if (!value) return '';
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid URL in env var: ${name}`);
  }
  return value;
}

function optionalInteger(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer in env var: ${name}`);
  }
  return value;
}

function optionalNumber(name, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid number in env var: ${name}`);
  }
  return value;
}

function optionalBoolean(name, fallback = false) {
  const raw = (process.env[name] ?? '').toString().trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new Error(`Invalid boolean in env var: ${name}`);
}

function optionalUsername(name) {
  const raw = (process.env[name] ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/^@+/, '').slice(0, 64);
}

function optionalChatIdList(name, { maxItems = 200 } = {}) {
  const raw = (process.env[name] ?? '').toString().trim();
  if (!raw) return [];

  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[,\s]+/g)) {
    const value = (part ?? '').toString().trim();
    if (!value) continue;
    if (!/^\d{4,20}$/.test(value)) {
      throw new Error(`Invalid chat id in env var: ${name}`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(Number(value));
    if (out.length >= maxItems) break;
  }
  return out;
}

const port = Number(process.env.API_PORT || 3000);
const telegramInitDataMaxAgeSec = Number(process.env.TELEGRAM_INITDATA_MAX_AGE || 86400);
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const automatedMessageTestChatIds = optionalChatIdList('AUTOMATED_MESSAGE_TEST_CHAT_IDS');
const legacyScheduledTasksTestChatIds = optionalChatIdList('SCHEDULED_TASKS_TEST_CHAT_IDS');
const effectiveAutomatedMessageTestChatIds = automatedMessageTestChatIds.length
  ? automatedMessageTestChatIds
  : legacyScheduledTasksTestChatIds;

const sslEnabled = (process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const sslRejectUnauthorized = (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';

const webappUrl = requireEnv('WEBAPP_URL');
const webappReturnUrlRaw = optionalUrl('WEBAPP_RETURN_URL');

// Load tokens from bot config files (deploy/bots/*.json)
const telegramBotTokensByBotKey = extractBotTokens();

// Validation: require at least one bot token
if (Object.keys(telegramBotTokensByBotKey).length === 0) {
  throw new Error(
    'Missing Telegram bot tokens. ' +
    'Add telegram_bot_token field to bot config files in deploy/bots/*.json'
  );
}

const botRuntimeRouteFlags = parseBotRuntimeRouteFlags(
  process.env.BOT_RUNTIME_ROUTE_FLAGS_JSON,
  Object.keys(telegramBotTokensByBotKey)
);

console.log(`Loaded Telegram bot tokens from bot config files for: ${Object.keys(telegramBotTokensByBotKey).join(', ')}`)

export const env = {
  port,
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${port}`,
  webappUrl,
  webappReturnUrl: webappReturnUrlRaw || webappUrl,
  webappReturnUrlIsCustom: Boolean(webappReturnUrlRaw),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseSsl: sslEnabled,
  databaseSslRejectUnauthorized: sslRejectUnauthorized,
  telegramBotTokensByBotKey,
  botRuntimeRouteFlags,
  telegramInitDataMaxAgeSec,
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: requireEnv('STRIPE_WEBHOOK_SECRET'),
  stripeBillingProductId: (process.env.STRIPE_BILLING_PRODUCT_ID || '').toString().trim(),
  stripePortalConfigId: process.env.STRIPE_PORTAL_CONFIG_ID || '',
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigins,
  planChangedWebhookUrl: process.env.PLAN_CHANGED_WEBHOOK_URL || '',
  adminDashboardPassword: process.env.ADMIN_DASHBOARD_PASSWORD || '',
  internalApiSecret: process.env.INTERNAL_API_SECRET || '',
  openaiApiKey: (process.env.OPENAI_API_KEY || '').toString().trim(),
  botRuntimeModel: (process.env.BOT_RUNTIME_MODEL || 'gpt-5.4').toString().trim() || 'gpt-5.4',
  botTranscriptionModel: (process.env.BOT_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe').toString().trim() || 'gpt-4o-transcribe',
  botTtsModel: (process.env.BOT_TTS_MODEL || 'gpt-4o-mini-tts').toString().trim() || 'gpt-4o-mini-tts',
  sentryDsn: (process.env.SENTRY_DSN || '').toString().trim(),
  sentryEnvironment: (process.env.SENTRY_ENVIRONMENT || '').toString().trim(),
  sentryRelease: (process.env.SENTRY_RELEASE || '').toString().trim(),
  sentryTracesSampleRate: optionalNumber('SENTRY_TRACES_SAMPLE_RATE', 0.1, { min: 0, max: 1 }),
  sentryProfileSessionSampleRate: optionalNumber('SENTRY_PROFILE_SESSION_SAMPLE_RATE', 0, { min: 0, max: 1 }),
  discordEventsWebhookUrl: optionalUrl('DISCORD_EVENTS_WEBHOOK_URL'),
  discordUserMilestoneStep: optionalInteger('DISCORD_USER_MILESTONE_STEP', 100, { min: 1, max: 1000000 }),
  topicGenerationModel: (process.env.TOPIC_GENERATION_MODEL || 'gpt-5.4').toString().trim() || 'gpt-5.4',
  reminderLlmModel: (process.env.REMINDER_LLM_MODEL || 'gpt-5-mini').toString().trim() || 'gpt-5-mini',
  idiomPracticeOpenaiModel: (process.env.IDIOM_PRACTICE_OPENAI_MODEL || process.env.TOPIC_GENERATION_MODEL || 'gpt-5.4').toString().trim() || 'gpt-5.4',
  idiomPracticeSendHourUtc: optionalInteger('IDIOM_PRACTICE_SEND_HOUR_UTC', 15, { min: 0, max: 23 }),
  idiomPracticeScanLimit: optionalInteger('IDIOM_PRACTICE_SCAN_LIMIT', 500, { min: 1, max: 5000 }),
  broadcastMaxRecipients: optionalInteger('BROADCAST_MAX_RECIPIENTS', 2000, { min: 1, max: 100000 }),
  broadcastProcessBatchSize: optionalInteger('BROADCAST_PROCESS_BATCH_SIZE', 100, { min: 1, max: 1000 }),
  broadcastPerMessageDelayMs: optionalInteger('BROADCAST_PER_MESSAGE_DELAY_MS', 35, { min: 0, max: 5000 }),
  broadcastSendConcurrency: optionalInteger('BROADCAST_SEND_CONCURRENCY', 5, { min: 1, max: 100 }),
  broadcastMediaChatId: optionalInteger('BROADCAST_MEDIA_CHAT_ID', 0),
  onboardingCompleteIdleMinutes: optionalInteger('ONBOARDING_COMPLETE_IDLE_MINUTES', 2, { min: 1, max: 1440 }),
  onboardingCompleteScanLimit: optionalInteger('ONBOARDING_COMPLETE_SCAN_LIMIT', 500, { min: 1, max: 5000 }),
  automatedMessageTestChatIds: effectiveAutomatedMessageTestChatIds,
  scheduledTasksTestChatIds: effectiveAutomatedMessageTestChatIds,
  jobRetryMaxAttempts: optionalInteger('JOB_RETRY_MAX_ATTEMPTS', 5, { min: 1, max: 100 }),
  defaultBotKey: (process.env.DEFAULT_BOT_KEY || 'uk-de').toString().trim().toLowerCase(),
  botKeyByTargetLang: optionalJsonObject('BOT_KEY_BY_TARGET_LANG_JSON'),
  webhooksAppendBotKey: optionalBoolean('WEBHOOKS_APPEND_BOT_KEY', false)
};
