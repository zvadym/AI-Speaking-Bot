import { timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import { env } from './env.js';
import { pool } from './db.js';
import { verifyInitData } from './telegram.js';
import { stripe } from './stripe.js';
import { signSession, requireAuth } from './auth.js';
import { loadBotConfigs } from './bot-configs.js';
import { buildBillingCurrencyCatalog } from './billing-currencies.js';
import { enqueueBroadcastCampaign as enqueueBroadcastCampaignJob } from './jobs.js';
import { getApiBoss, stopApiBoss } from './queue.js';

const app = express();

app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : true }));
app.use(morgan('tiny'));

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).send('Missing stripe-signature');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.stripeWebhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleStripeEvent(event);
    return res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler failed', err);
    return res.status(500).json({ error: 'webhook_failed' });
  }
});

app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/public/billing/currencies', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json(buildBillingCurrencyCatalog(publicBotCatalog));
});

function safeEqualString(a, b) {
  const aa = typeof a === 'string' ? a : '';
  const bb = typeof b === 'string' ? b : '';
  const aBuf = Buffer.from(aa);
  const bBuf = Buffer.from(bb);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function requireAdmin(req, res, next) {
  if (!env.adminDashboardPassword) {
    return res.status(404).json({ error: 'not_found' });
  }

  const provided = (req.headers['x-admin-password'] || '').toString();
  if (!provided || !safeEqualString(provided, env.adminDashboardPassword)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PURCHASE_ALLOWED_TIERS = new Set(['pro']);
const PURCHASE_ALLOWED_BILLING_INTERVALS = new Set(['month', 'year']);
const QUERY_TRUE_VALUES = new Set(['true', '1', 'yes']);
const FEEDBACK_CATEGORIES = new Set(['bug', 'idea', 'billing', 'coach']);
const MINIAPP_FEEDBACK_MESSAGE_MAX_LEN = 1000;
const ACTION_EVENT_TYPES = [
  'start',
  'profile_set_level',
  'first_voice_sent',
  'first_answer_delivered',
  'topic_set',
  'topic_message_sent',
  'topic_clear',
  'day1_return',
  'paywall_shown',
  'purchase_success'
];
const TOPIC_USAGE_ACTION_TYPES = ['topic_set', 'topic_message_sent'];

function normalizeBillingInterval(raw, fallback = 'month') {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return fallback;
  if (!PURCHASE_ALLOWED_BILLING_INTERVALS.has(value)) return null;
  return value;
}

function parseQueryBoolean(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return false;
  return QUERY_TRUE_VALUES.has(value);
}

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

function normalizeCurrencyCode(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(value)) return null;
  return value;
}

function normalizeOptionalText(raw, maxLen) {
  const value = (raw ?? '').toString().trim();
  if (!value) return null;
  return value.slice(0, maxLen);
}

function normalizeFeedbackCategory(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (!FEEDBACK_CATEGORIES.has(value)) return null;
  return value;
}

function normalizeStringArray(raw, { maxItems = 12, maxItemLen = 32 } = {}) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((v) => (v ?? '').toString().trim())
    .filter(Boolean)
    .map((v) => v.slice(0, maxItemLen))
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

const publicBotCatalog = buildPublicBotCatalog(loadBotConfigs());
const publicBotCatalogByKey = new Map(publicBotCatalog.map((bot) => [bot.bot_key, bot]));

function publicBotMetaForKey(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return null;
  return publicBotCatalogByKey.get(botKey) || null;
}

function requestedBotKeyFromReq(req) {
  return normalizeBotKey(
    req.query?.bot_key ??
    req.query?.botKey ??
    req.query?.['bot-key'] ??
    req.body?.bot_key ??
    req.body?.botKey ??
    req.headers?.['x-bot-key'] ??
    null
  );
}

function botKeyFromTargetLang(targetLangRaw) {
  const targetLang = (targetLangRaw ?? '').toString().trim().toLowerCase();
  if (targetLang && env.botKeyByTargetLang && env.botKeyByTargetLang[targetLang]) {
    return normalizeBotKey(env.botKeyByTargetLang[targetLang]);
  }
  if (targetLang) {
    const base = (env.defaultBotKey || 'uk-de').split('-')[0] || 'uk';
    return normalizeBotKey(`${base}-${targetLang}`);
  }
  return normalizeBotKey(env.defaultBotKey);
}

async function resolveUserBotKey(chatIdRaw) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) return normalizeBotKey(env.defaultBotKey);

  const { rows } = await pool.query(
    `SELECT bot_key
       FROM user_bots
      WHERE chat_id = $1
      ORDER BY
        COALESCE(is_active, true) DESC,
        COALESCE(last_seen_at, updated_at, created_at) DESC,
        bot_key ASC
      LIMIT 1`,
    [chatId]
  );

  const row = rows[0] || null;
  const fromUser = normalizeBotKey(row?.bot_key || null);
  if (fromUser) return fromUser;
  return normalizeBotKey(env.defaultBotKey) || 'uk-de';
}

function targetLangFromBotKey(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return null;
  const parts = botKey.split('-');
  return parts[1] || null;
}

async function getMeUserRow(chatIdRaw, botKeyRaw = null) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) return null;

  const normalizedBotKey = normalizeBotKey(botKeyRaw);
  const resolvedBotKey = await resolveUserBotKey(chatId);
  let effectiveBotKey = normalizedBotKey || resolvedBotKey;
  if (!effectiveBotKey) effectiveBotKey = normalizeBotKey(env.defaultBotKey) || 'uk-de';

  async function loadRowByBotKey(botKey) {
    const { rows } = await pool.query(
      `SELECT
         u.chat_id,
         u.username,
         u.first_name,
         ub.bot_key,
         split_part(ub.bot_key, '-', 2) AS target_lang,
         ub.level,
         ub.reply_mode,
         ub.tts_voice,
         u.plan_tier,
         u.plan_expires_at,
         u.plan_autorenew
       FROM users u
       LEFT JOIN user_bots ub
         ON ub.chat_id = u.chat_id
        AND ub.bot_key = $2
       WHERE u.chat_id = $1
       LIMIT 1`,
      [chatId, botKey]
    );
    return rows[0] || null;
  }

  let row = await loadRowByBotKey(effectiveBotKey);
  if (!row) return null;

  if (!row.bot_key && resolvedBotKey && resolvedBotKey !== effectiveBotKey) {
    const fallbackRow = await loadRowByBotKey(resolvedBotKey);
    if (fallbackRow) {
      row = fallbackRow;
      effectiveBotKey = resolvedBotKey;
    }
  }

  if (!row.bot_key && normalizedBotKey && normalizedBotKey !== effectiveBotKey) {
    const explicitRow = await loadRowByBotKey(normalizedBotKey);
    if (explicitRow) {
      row = explicitRow;
      effectiveBotKey = normalizedBotKey;
    }
  }

  const resolvedKey = normalizeBotKey(row.bot_key || effectiveBotKey) || normalizeBotKey(effectiveBotKey);
  const botMeta = publicBotMetaForKey(resolvedKey);
  const learningLanguage = normalizeLanguageCode(
    botMeta?.learning_language ||
    row.target_lang ||
    targetLangFromBotKey(resolvedKey) ||
    'de'
  ) || 'de';
  const baseLanguage = normalizeLanguageCode(
    botMeta?.base_language ||
    (resolvedKey ? resolvedKey.split('-')[0] : '')
  );

  return {
    ...row,
    bot_key: resolvedKey || row.bot_key || effectiveBotKey,
    target_lang: learningLanguage,
    learning_language: learningLanguage,
    base_language: baseLanguage || null,
    bot_name: botMeta?.bot_name || null,
    telegram_url: botMeta?.telegram_url || null,
    teacher_avatar_emoji: botMeta?.teacher_avatar_emoji || null,
    teacher_tagline_uk: botMeta?.teacher_tagline_uk || null,
    teacher_tagline_en: botMeta?.teacher_tagline_en || null,
    teacher_tagline_it: botMeta?.teacher_tagline_it || botMeta?.teacher_tagline_en || botMeta?.teacher_tagline_uk || null,
    teacher_style_tags: botMeta?.teacher_style_tags || null,
    level: row.level || 'a1',
    reply_mode: row.reply_mode || 'text',
    tts_voice: row.tts_voice || 'marin'
  };
}

async function listUserBots(chatIdRaw) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) return [];

  const { rows } = await pool.query(
    `SELECT
       ub.bot_key,
       split_part(ub.bot_key, '-', 2) AS target_lang,
       ub.level,
       ub.reply_mode,
       ub.tts_voice,
       ub.is_active,
       ub.last_seen_at
     FROM user_bots ub
     WHERE ub.chat_id = $1
     ORDER BY
       COALESCE(ub.is_active, true) DESC,
       COALESCE(ub.last_seen_at, ub.updated_at, ub.created_at) DESC,
       ub.bot_key ASC`,
    [chatId]
  );

  return (rows || []).map((row) => {
    const botKey = normalizeBotKey(row.bot_key) || row.bot_key;
    const botMeta = publicBotMetaForKey(botKey);
    const learningLanguage = normalizeLanguageCode(
      botMeta?.learning_language ||
      row.target_lang ||
      targetLangFromBotKey(botKey)
    );
    const baseLanguage = normalizeLanguageCode(
      botMeta?.base_language ||
      (botKey ? botKey.split('-')[0] : '')
    );

    return {
      ...row,
      bot_key: botKey,
      target_lang: learningLanguage || row.target_lang || null,
      learning_language: learningLanguage || row.target_lang || null,
      base_language: baseLanguage || null,
      bot_name: botMeta?.bot_name || null,
      telegram_url: botMeta?.telegram_url || null,
      teacher_avatar_emoji: botMeta?.teacher_avatar_emoji || null,
      teacher_tagline_uk: botMeta?.teacher_tagline_uk || null,
      teacher_tagline_en: botMeta?.teacher_tagline_en || null,
      teacher_tagline_it: botMeta?.teacher_tagline_it || botMeta?.teacher_tagline_en || botMeta?.teacher_tagline_uk || null,
      teacher_style_tags: botMeta?.teacher_style_tags || null
    };
  });
}

function listAvailableBotsForUser(userBots = []) {
  const normalizedUserBots = Array.isArray(userBots) ? userBots : [];
  const byKey = new Map(
    normalizedUserBots
      .map((row) => [normalizeBotKey(row?.bot_key), row])
      .filter(([key]) => Boolean(key))
  );

  const merged = publicBotCatalog.map((bot) => {
    const linked = byKey.get(bot.bot_key) || null;
    return {
      ...bot,
      is_connected: Boolean(linked),
      level: linked?.level || null,
      reply_mode: linked?.reply_mode || null,
      tts_voice: linked?.tts_voice || null,
      is_active: linked?.is_active ?? null,
      last_seen_at: linked?.last_seen_at || null
    };
  });

  for (const row of normalizedUserBots) {
    const botKey = normalizeBotKey(row?.bot_key);
    if (!botKey || publicBotCatalogByKey.has(botKey)) continue;
    merged.push({
      bot_key: botKey,
      base_language: normalizeLanguageCode(row?.base_language || botKey.split('-')[0]) || null,
      learning_language: normalizeLanguageCode(row?.learning_language || row?.target_lang || targetLangFromBotKey(botKey)) || null,
      target_lang: normalizeLanguageCode(row?.learning_language || row?.target_lang || targetLangFromBotKey(botKey)) || null,
      bot_name: row?.bot_name || null,
      telegram_url: row?.telegram_url || null,
      teacher_avatar_emoji: row?.teacher_avatar_emoji || null,
      teacher_tagline_uk: row?.teacher_tagline_uk || null,
      teacher_tagline_en: row?.teacher_tagline_en || null,
      teacher_tagline_it: row?.teacher_tagline_it || row?.teacher_tagline_en || row?.teacher_tagline_uk || null,
      teacher_style_tags: row?.teacher_style_tags || null,
      is_connected: true,
      level: row?.level || null,
      reply_mode: row?.reply_mode || null,
      tts_voice: row?.tts_voice || null,
      is_active: row?.is_active ?? null,
      last_seen_at: row?.last_seen_at || null
    });
  }

  merged.sort((a, b) => {
    const langA = a.learning_language || '';
    const langB = b.learning_language || '';
    if (langA !== langB) return langA.localeCompare(langB);
    const nameA = a.bot_name || a.bot_key;
    const nameB = b.bot_name || b.bot_key;
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.bot_key.localeCompare(b.bot_key);
  });

  return merged;
}

async function getUserUsageSummary(chatIdRaw) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) return null;

  const { rows } = await pool.query(
    `WITH user_plan AS (
       SELECT
         chat_id,
         COALESCE(plan_tier, 'free') AS plan_tier,
         plan_expires_at,
         COALESCE(plan_autorenew, false) AS plan_autorenew,
         pending_plan_tier,
         pending_plan_effective_at,
         override_plan_tier,
         override_expires_at
       FROM users
       WHERE chat_id = $1
       LIMIT 1
     ),
     effective AS (
       SELECT
         chat_id,
         plan_expires_at,
         plan_autorenew,
         pending_plan_tier,
         pending_plan_effective_at,
         CASE
           WHEN override_plan_tier IS NOT NULL AND override_expires_at IS NOT NULL AND NOW() < override_expires_at
             THEN override_plan_tier
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN plan_tier
           ELSE 'free'
         END AS effective_tier
       FROM user_plan
     ),
     p AS (
       SELECT
         tier,
         voice_seconds_limit AS limit_seconds,
         voice_limit_period AS limit_period
       FROM plans
       WHERE tier = (SELECT effective_tier FROM effective)
       LIMIT 1
     ),
     usage_totals AS (
       SELECT
         COALESCE(SUM(uh.in_voice_seconds + uh.out_voice_seconds), 0)::int AS used_seconds
       FROM usage_hourly uh
       WHERE uh.chat_id = (SELECT chat_id FROM effective)
         AND (
           COALESCE((SELECT limit_period FROM p), 'lifetime') <> 'month'
           OR uh.hour_start >= date_trunc('month', NOW())
         )
     )
     SELECT
       (SELECT effective_tier FROM effective) AS tier,
       (SELECT plan_expires_at FROM effective) AS plan_expires_at,
       (SELECT plan_autorenew FROM effective) AS plan_autorenew,
       (SELECT pending_plan_tier FROM effective) AS pending_plan_tier,
       (SELECT pending_plan_effective_at FROM effective) AS pending_plan_effective_at,
       COALESCE((SELECT limit_period FROM p), 'lifetime') AS limit_period,
       COALESCE((SELECT limit_seconds FROM p), 0) AS limit_seconds,
       COALESCE((SELECT used_seconds FROM usage_totals), 0) AS used_seconds,
       GREATEST(COALESCE((SELECT limit_seconds FROM p), 0) - COALESCE((SELECT used_seconds FROM usage_totals), 0), 0) AS remaining_seconds,
       (
         COALESCE((SELECT limit_seconds FROM p), 0) > 0
         AND COALESCE((SELECT used_seconds FROM usage_totals), 0) >= COALESCE((SELECT limit_seconds FROM p), 0)
       ) AS limit_reached`,
    [chatId]
  );

  return rows[0] || null;
}

function serializePlanCatalogRows(rows, { includeStripePriceId = false } = {}) {
  return (rows || [])
    .filter((row) => row?.currency && row?.amount_cents != null && row?.billing_interval)
    .map((row) => ({
      tier: row.tier,
      voice_seconds_limit: row.voice_seconds_limit,
      voice_limit_period: row.voice_limit_period,
      currency: row.currency,
      amount_cents: row.amount_cents,
      billing_interval: row.billing_interval,
      ...(includeStripePriceId ? { stripe_price_id: row.stripe_price_id || null } : {})
    }));
}

async function loadPlanCatalog(currency, includeAllIntervals, { includeStripePriceId = false } = {}) {
  const stripePriceSelect = includeStripePriceId ? ', pp.stripe_price_id' : '';
  const { rows } = await pool.query(
    `SELECT p.tier, p.voice_seconds_limit, p.voice_limit_period,
            pp.currency, pp.amount_cents, pp.billing_interval${stripePriceSelect}
       FROM plans p
       LEFT JOIN plan_prices pp
         ON p.tier = pp.tier
        AND pp.currency = $1
        AND pp.active = true
        AND ($2::boolean = true OR pp.billing_interval = 'month')
      WHERE p.tier IN ('pro')
      ORDER BY p.tier,
               CASE
                 WHEN pp.billing_interval = 'month' THEN 0
                 WHEN pp.billing_interval = 'year' THEN 1
                 ELSE 2
               END`,
    [currency, includeAllIntervals]
  );

  return serializePlanCatalogRows(rows, { includeStripePriceId });
}

function normalizeRuntimeCurrencyCode(raw) {
  const currency = normalizeCurrencyCode(raw);
  return currency ? currency.toUpperCase() : null;
}

function parsePositiveInteger(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function stripeErrorPayload(err, fallback = 'stripe_error') {
  const message = (err?.raw?.message || err?.message || fallback).toString();
  const code = (err?.code || fallback).toString();
  const payload = {
    error: fallback,
    detail: message,
    code
  };
  if (err?.param) payload.param = String(err.param);
  return payload;
}

function httpError(status, error, detail, extra = {}) {
  const err = new Error(detail || error);
  err.status = status;
  err.payload = {
    error,
    ...(detail ? { detail } : {}),
    ...extra
  };
  return err;
}

function billingRouteErrorResponse(res, err, fallbackStatus = 400) {
  if (err?.status && err?.payload) {
    return res.status(err.status).json(err.payload);
  }
  return res.status(fallbackStatus).json(stripeErrorPayload(err));
}

function getStripeBillingProductId() {
  const productId = (env.stripeBillingProductId || '').toString().trim();
  if (!productId) {
    throw httpError(
      503,
      'stripe_billing_product_not_configured',
      'Set STRIPE_BILLING_PRODUCT_ID to manage billing prices from the admin dashboard.'
    );
  }
  return productId;
}

function buildBillingPriceKey(currencyRaw, billingIntervalRaw) {
  const currency = normalizeCurrencyCode(currencyRaw);
  const billingInterval = normalizeBillingInterval(billingIntervalRaw, null);
  if (!currency || !billingInterval) return null;
  return `${currency}:${billingInterval}`;
}

function serializeRuntimePlanPrice(row) {
  if (!row) return null;
  const currency = normalizeCurrencyCode(row.currency);
  return {
    tier: row.tier || 'pro',
    currency: currency || String(row.currency || '').trim().toLowerCase() || null,
    amount_cents: Number.isFinite(Number(row.amount_cents)) ? Number(row.amount_cents) : null,
    billing_interval: row.billing_interval || null,
    active: Boolean(row.active),
    stripe_price_id: row.stripe_price_id || null
  };
}

function serializeBillingPriceSummary(price) {
  const currency = normalizeCurrencyCode(price?.currency);
  const billingInterval = normalizeBillingInterval(price?.recurring?.interval, null);
  return {
    stripe_price_id: price.id,
    product_id:
      typeof price.product === 'string'
        ? price.product
        : price.product?.id || null,
    currency,
    amount_cents: Number.isFinite(Number(price?.unit_amount)) ? Number(price.unit_amount) : null,
    billing_interval: billingInterval,
    active: Boolean(price.active),
    nickname: price.nickname || null,
    created_at: Number.isFinite(Number(price?.created)) ? new Date(Number(price.created) * 1000).toISOString() : null
  };
}

function serializeBillingPriceRow(price, runtimeRow = null) {
  const summary = serializeBillingPriceSummary(price);
  const runtime = serializeRuntimePlanPrice(runtimeRow);
  const isRuntimeActive = Boolean(runtime?.active && runtime?.stripe_price_id === summary.stripe_price_id);

  let status = 'stripe_only';
  if (!summary.active) status = 'archived';
  else if (isRuntimeActive) status = 'live';

  return {
    ...summary,
    is_runtime_active: isRuntimeActive,
    status,
    runtime
  };
}

function serializeRuntimeOnlyBillingRow(row) {
  const runtime = serializeRuntimePlanPrice(row);
  return {
    stripe_price_id: row?.stripe_price_id || null,
    product_id: null,
    currency: normalizeCurrencyCode(row?.currency) || null,
    amount_cents: Number.isFinite(Number(row?.amount_cents)) ? Number(row.amount_cents) : null,
    billing_interval: row?.billing_interval || null,
    active: Boolean(row?.active),
    nickname: null,
    created_at: null,
    is_runtime_active: Boolean(row?.active),
    status: 'runtime_only',
    runtime,
    stripe_error: 'not_found_on_configured_product'
  };
}

function compareBillingRows(a, b) {
  const activeA = Boolean(a?.active || a?.is_runtime_active);
  const activeB = Boolean(b?.active || b?.is_runtime_active);
  if (activeA !== activeB) return activeA ? -1 : 1;

  const intervalA = a?.billing_interval === 'month' ? 0 : a?.billing_interval === 'year' ? 1 : 2;
  const intervalB = b?.billing_interval === 'month' ? 0 : b?.billing_interval === 'year' ? 1 : 2;
  if (intervalA !== intervalB) return intervalA - intervalB;

  const currencyA = String(a?.currency || '').toLowerCase();
  const currencyB = String(b?.currency || '').toLowerCase();
  if (currencyA !== currencyB) return currencyA.localeCompare(currencyB);

  const runtimeA = Boolean(a?.is_runtime_active);
  const runtimeB = Boolean(b?.is_runtime_active);
  if (runtimeA !== runtimeB) return runtimeA ? -1 : 1;

  const createdA = Date.parse(a?.created_at || '') || 0;
  const createdB = Date.parse(b?.created_at || '') || 0;
  if (createdA !== createdB) return createdB - createdA;

  return String(a?.stripe_price_id || '').localeCompare(String(b?.stripe_price_id || ''));
}

async function listStripeBillingProductPrices(productId) {
  const prices = [];
  let startingAfter = null;

  while (true) {
    const page = await stripe.prices.list({
      product: productId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    prices.push(...page.data);

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id || null;
    if (!startingAfter) break;
  }

  return prices;
}

function assertManagedStripePrice(price, productId) {
  const actualProductId =
    typeof price?.product === 'string'
      ? price.product
      : price?.product?.id || null;

  if (!actualProductId || actualProductId !== productId) {
    throw httpError(400, 'price_not_on_configured_product', 'Selected Stripe price does not belong to STRIPE_BILLING_PRODUCT_ID.');
  }

  if (price?.type !== 'recurring' || !price?.recurring?.interval) {
    throw httpError(400, 'price_not_recurring', 'Only recurring Stripe prices are supported.');
  }

  const billingInterval = normalizeBillingInterval(price.recurring.interval, null);
  if (!billingInterval) {
    throw httpError(400, 'unsupported_billing_interval', 'Only month and year recurring Stripe prices are supported.');
  }

  const currency = normalizeCurrencyCode(price.currency);
  if (!currency) {
    throw httpError(400, 'bad_currency', 'Stripe price has an unsupported currency.');
  }

  const amountCents = Number.isFinite(Number(price.unit_amount)) ? Number(price.unit_amount) : null;
  if (!amountCents || amountCents <= 0) {
    throw httpError(400, 'bad_unit_amount', 'Stripe price must have a positive unit_amount.');
  }

  return {
    product_id: actualProductId,
    currency,
    billing_interval: billingInterval,
    amount_cents: amountCents
  };
}

async function getManagedStripePrice(priceId, productId) {
  const price = await stripe.prices.retrieve(priceId);
  const normalized = assertManagedStripePrice(price, productId);
  return { price, normalized };
}

async function loadRuntimePlanPrices(client = pool) {
  const { rows } = await client.query(
    `SELECT id, tier, currency, amount_cents, billing_interval, stripe_price_id, active, created_at, updated_at
       FROM plan_prices
      WHERE tier = 'pro'
      ORDER BY
        CASE
          WHEN billing_interval = 'month' THEN 0
          WHEN billing_interval = 'year' THEN 1
          ELSE 2
        END,
        currency ASC`
  );

  return rows;
}

async function loadAdminBillingSnapshot(productId, client = pool) {
  const [stripePricesRaw, runtimeRows] = await Promise.all([
    listStripeBillingProductPrices(productId),
    loadRuntimePlanPrices(client)
  ]);

  const stripePrices = stripePricesRaw.filter((price) => {
    if (price?.type !== 'recurring') return false;
    return Boolean(normalizeBillingInterval(price?.recurring?.interval, null));
  });

  const runtimeByKey = new Map();
  const runtimeByPriceId = new Map();
  for (const row of runtimeRows) {
    const key = buildBillingPriceKey(row.currency, row.billing_interval);
    if (key && !runtimeByKey.has(key)) runtimeByKey.set(key, row);
    if (row?.stripe_price_id) runtimeByPriceId.set(String(row.stripe_price_id), row);
  }

  const matchedRuntimePriceIds = new Set();
  const prices = stripePrices.map((price) => {
    const key = buildBillingPriceKey(price.currency, price.recurring?.interval);
    const runtimeRow = (key && runtimeByKey.get(key)) || runtimeByPriceId.get(String(price.id)) || null;
    if (runtimeRow?.stripe_price_id) matchedRuntimePriceIds.add(String(runtimeRow.stripe_price_id));
    return serializeBillingPriceRow(price, runtimeRow);
  });

  const runtimeOnlyRows = runtimeRows
    .filter((row) => row?.stripe_price_id && !matchedRuntimePriceIds.has(String(row.stripe_price_id)))
    .map((row) => serializeRuntimeOnlyBillingRow(row));

  return {
    product_id: productId,
    prices: [...prices, ...runtimeOnlyRows].sort(compareBillingRows)
  };
}

function summarizeBillingEntry({ currency, billing_interval: billingInterval, stripe_price_id: stripePriceId, amount_cents: amountCents }) {
  return {
    currency,
    billing_interval: billingInterval,
    stripe_price_id: stripePriceId,
    amount_cents: amountCents
  };
}

async function getUserStreakSummary(chatIdRaw) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) {
    return {
      current: 0,
      longest: 0,
      status: 'broken',
      activity_today: false,
      last_activity_at: null,
      activity_days: []
    };
  }

  const { rows } = await pool.query(
    `WITH activity AS (
       SELECT v.occurred_at
       FROM voice_usage_events v
       WHERE v.chat_id = $1

       UNION ALL

       SELECT m.created_at AS occurred_at
       FROM messages m
       WHERE m.chat_id = $1
         AND m.role = 'user'
     ),
     dates AS (
       SELECT (NOW() AT TIME ZONE 'UTC')::date AS today_utc
     ),
     activity_days AS (
       SELECT DISTINCT date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day_utc
       FROM activity
     ),
     recent_activity_days AS (
       SELECT ad.day_utc
       FROM activity_days ad, dates d
       WHERE ad.day_utc >= (d.today_utc - 34)
       ORDER BY ad.day_utc
     ),
     streak_groups AS (
       SELECT
         day_utc,
         day_utc - ROW_NUMBER() OVER (ORDER BY day_utc)::int AS grp
       FROM activity_days
     ),
     streaks AS (
       SELECT
         MIN(day_utc) AS start_day,
         MAX(day_utc) AS end_day,
         COUNT(*)::int AS streak_days
       FROM streak_groups
       GROUP BY grp
     ),
     longest_streak AS (
       SELECT COALESCE(MAX(streak_days), 0)::int AS streak_days
       FROM streaks
     ),
     current_streak AS (
       SELECT s.streak_days, s.end_day
       FROM streaks s, dates d
       WHERE s.end_day = d.today_utc
          OR s.end_day = (d.today_utc - 1)
       ORDER BY s.end_day DESC
       LIMIT 1
     ),
     today_activity AS (
       SELECT EXISTS(
         SELECT 1
         FROM activity_days ad, dates d
         WHERE ad.day_utc = d.today_utc
       ) AS value
     ),
     yesterday_activity AS (
       SELECT EXISTS(
         SELECT 1
         FROM activity_days ad, dates d
         WHERE ad.day_utc = (d.today_utc - 1)
       ) AS value
     ),
     last_activity AS (
       SELECT MAX(occurred_at) AS occurred_at
       FROM activity
     )
     SELECT
       CASE
         WHEN (SELECT value FROM today_activity) THEN COALESCE((SELECT streak_days FROM current_streak), 0)
         WHEN (SELECT value FROM yesterday_activity) THEN COALESCE((SELECT streak_days FROM current_streak), 0)
         ELSE 0
       END::int AS current_streak_days,
       (SELECT streak_days FROM longest_streak)::int AS longest_streak_days,
       CASE
         WHEN (SELECT value FROM today_activity) THEN 'active'
         WHEN (SELECT value FROM yesterday_activity) THEN 'at_risk'
         ELSE 'broken'
       END AS streak_status,
       (SELECT value FROM today_activity) AS activity_today,
       (SELECT occurred_at FROM last_activity) AS last_activity_at,
       COALESCE((SELECT ARRAY_AGG(day_utc) FROM recent_activity_days), ARRAY[]::date[]) AS recent_activity_days`,
    [chatId]
  );

  const row = rows[0] || {};
  return {
    current: Number(row.current_streak_days || 0),
    longest: Number(row.longest_streak_days || 0),
    status: row.streak_status || 'broken',
    activity_today: Boolean(row.activity_today),
    last_activity_at: row.last_activity_at || null,
    activity_days: Array.isArray(row.recent_activity_days)
      ? row.recent_activity_days.map((value) => {
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        return (value ?? '').toString().slice(0, 10);
      }).filter(Boolean)
      : []
  };
}

function feedbackPreviewText(raw) {
  const text = (raw ?? '').toString().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, 160);
}

async function getUserFeedbackSummary(chatIdRaw, botKeyRaw) {
  const chatId = Number(chatIdRaw);
  const botKey = normalizeBotKey(botKeyRaw);
  if (!Number.isFinite(chatId) || !botKey) {
    return {
      has_thread: false,
      archived: false,
      unread_admin_replies: 0,
      user_last_read_at: null,
      last_message_at: null,
      last_message_preview: '',
      last_message_sender: null
    };
  }

  const [threadRes, lastMessageRes, unreadRes] = await Promise.all([
    pool.query(
      `SELECT archived_at, user_last_read_at
       FROM feedback_threads
       WHERE chat_id = $1
         AND bot_key = $2
       LIMIT 1`,
      [chatId, botKey]
    ),
    pool.query(
      `SELECT sender, created_at, text
       FROM (
         SELECT
           'user'::text AS sender,
           f.created_at,
           CASE
             WHEN f.kind = 'voice'
               THEN COALESCE(NULLIF(f.transcript, ''), NULLIF(f.feedback_text, ''), '')
             ELSE COALESCE(f.feedback_text, '')
           END AS text
         FROM feedback f
         WHERE f.chat_id = $1
           AND f.bot_key = $2

         UNION ALL

         SELECT
           'admin'::text AS sender,
           r.created_at,
           r.message_text AS text
         FROM feedback_replies r
         WHERE r.chat_id = $1
           AND r.bot_key = $2
       ) messages
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId, botKey]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS unread_admin_replies
       FROM feedback_replies r
       LEFT JOIN feedback_threads ft
         ON ft.chat_id = r.chat_id
        AND ft.bot_key = r.bot_key
       WHERE r.chat_id = $1
         AND r.bot_key = $2
         AND (
           ft.user_last_read_at IS NULL
           OR r.created_at > ft.user_last_read_at
         )`,
      [chatId, botKey]
    )
  ]);

  const threadRow = threadRes.rows[0] || null;
  const lastRow = lastMessageRes.rows[0] || null;
  const unreadAdminReplies = Number(unreadRes.rows[0]?.unread_admin_replies || 0);

  return {
    has_thread: Boolean(lastRow),
    archived: Boolean(threadRow?.archived_at),
    unread_admin_replies: unreadAdminReplies,
    user_last_read_at: threadRow?.user_last_read_at || null,
    last_message_at: lastRow?.created_at || null,
    last_message_preview: feedbackPreviewText(lastRow?.text),
    last_message_sender: lastRow?.sender || null
  };
}

async function getUserFeedbackThread(chatIdRaw, botKeyRaw) {
  const chatId = Number(chatIdRaw);
  const botKey = normalizeBotKey(botKeyRaw);
  if (!Number.isFinite(chatId) || !botKey) {
    return {
      bot_key: botKey || null,
      thread: {
        archived: false,
        user_last_read_at: null,
        unread_admin_replies: 0
      },
      items: []
    };
  }

  const [threadRes, itemsRes, unreadSummary] = await Promise.all([
    pool.query(
      `SELECT archived_at, user_last_read_at
       FROM feedback_threads
       WHERE chat_id = $1
         AND bot_key = $2
       LIMIT 1`,
      [chatId, botKey]
    ),
    pool.query(
      `SELECT *
       FROM (
         SELECT
           f.id,
           'feedback'::text AS kind,
           'user'::text AS sender,
           f.category,
           CASE
             WHEN f.kind = 'voice'
               THEN COALESCE(NULLIF(f.transcript, ''), NULLIF(f.feedback_text, ''), '')
             ELSE COALESCE(f.feedback_text, '')
           END AS text,
           f.created_at
         FROM feedback f
         WHERE f.chat_id = $1
           AND f.bot_key = $2

         UNION ALL

         SELECT
           r.id,
           'reply'::text AS kind,
           'admin'::text AS sender,
           NULL::text AS category,
           r.message_text AS text,
           r.created_at
         FROM feedback_replies r
         WHERE r.chat_id = $1
           AND r.bot_key = $2
       ) thread_items
       ORDER BY created_at ASC, id ASC`,
      [chatId, botKey]
    ),
    getUserFeedbackSummary(chatId, botKey)
  ]);

  const threadRow = threadRes.rows[0] || null;
  return {
    bot_key: botKey,
    thread: {
      archived: Boolean(threadRow?.archived_at),
      user_last_read_at: threadRow?.user_last_read_at || null,
      unread_admin_replies: unreadSummary.unread_admin_replies
    },
    items: (itemsRes.rows || []).map((row) => ({
      id: Number(row.id || 0),
      kind: row.kind || 'feedback',
      sender: row.sender || 'user',
      category: row.category || null,
      text: (row.text || '').toString(),
      created_at: row.created_at
    }))
  };
}

function webhookUrlForBot(templateUrl, hookName, botKeyRaw, { forceAppendBotKey = false } = {}) {
  const template = (templateUrl ?? '').toString().trim();
  if (!template) return '';
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return template;

  if (template.includes('{bot_key}')) {
    return template.split('{bot_key}').join(botKey);
  }

  if (!env.webhooksAppendBotKey && !forceAppendBotKey) {
    return template;
  }

  try {
    const u = new URL(template);
    const suffix = `-${botKey}`;
    if (u.pathname.endsWith(suffix)) return u.toString();
    if (u.pathname.endsWith(`/${hookName}`)) {
      u.pathname = `${u.pathname}${suffix}`;
      return u.toString();
    }
    return template;
  } catch {
    const suffix = `-${botKey}`;
    if (template.endsWith(suffix)) return template;
    if (template.endsWith(`/${hookName}`)) return `${template}${suffix}`;
    return template;
  }
}

function resolveTelegramBotToken(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (botKey) {
    const fromMap = env.telegramBotTokensByBotKey?.[botKey];
    if (typeof fromMap === 'string' && fromMap.trim()) return fromMap;
  }
  // Fall back to first available token if bot key not specified
  const first = Object.values(env.telegramBotTokensByBotKey || {}).find((v) => typeof v === 'string' && v.trim());
  return first || '';
}

function parseUtcBoundary(raw, fallbackDate) {
  const value = (raw ?? '').toString().trim();
  if (!value) return fallbackDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(d.getTime())) return d;
    return null;
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function parseChatIdList(raw) {
  const value = (raw ?? '').toString().trim();
  if (!value) return [];

  const parts = value.split(/[\s,]+/g);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const s = (part ?? '').toString().trim();
    if (!s) continue;
    if (!/^\d{4,20}$/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

function parseAdminRange(req) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultTo = new Date(todayUtc.getTime() + DAY_MS); // exclusive: start of tomorrow UTC
  const defaultFrom = new Date(defaultTo.getTime() - 30 * DAY_MS);

  const from = parseUtcBoundary(req.query.from, defaultFrom);
  const to = parseUtcBoundary(req.query.to, defaultTo);
  if (!from || !to) return { ok: false, error: 'bad_date' };
  if (!(from < to)) return { ok: false, error: 'bad_range' };
  if (to.getTime() - from.getTime() > 400 * DAY_MS) return { ok: false, error: 'range_too_large' };

  const payloadRaw = (req.query.payload ?? '').toString().trim();
  const payload = payloadRaw ? payloadRaw.slice(0, 200) : null;

  const excludeChatIds = parseChatIdList(req.query.exclude_chat_ids ?? req.query.excludeChatIds);

  return { ok: true, from, to, payload, excludeChatIds };
}

function safeActionProperties(raw) {
  if (!raw || typeof raw !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(raw));
  } catch {
    return {};
  }
}

async function recordActionEvent({
  chatId,
  botKey = null,
  actionType,
  source = 'api',
  idempotencyKey = null,
  properties = {},
  occurredAt = null
}) {
  if (!ACTION_EVENT_TYPES.includes(actionType)) return;
  const normalizedChatId = Number(chatId);
  if (!Number.isFinite(normalizedChatId)) return;

  await pool.query(
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
       $1,
       $2,
       $3,
       $4,
       $5,
       $6::jsonb,
       COALESCE($7::timestamptz, NOW())
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      normalizedChatId,
      normalizeBotKey(botKey),
      actionType,
      (source || 'api').toString().slice(0, 64),
      idempotencyKey ? idempotencyKey.toString().slice(0, 200) : null,
      JSON.stringify(safeActionProperties(properties)),
      occurredAt
    ]
  );
}

async function recordActionEventSafe(payload) {
  try {
    await recordActionEvent(payload);
  } catch (err) {
    console.warn('action_events insert failed', {
      actionType: payload?.actionType || null,
      chatId: payload?.chatId || null,
      botKey: payload?.botKey || null,
      err: err?.message || String(err)
    });
  }
}

const BROADCAST_ALLOWED_TIERS = new Set(['free', 'plus', 'pro']);
const BROADCAST_LAST_ACTIVITY_MODES = new Set(['active_within', 'inactive_for', 'never_active']);
const BROADCAST_USAGE_MODES = new Set(['reached', 'percent_gte']);
const BROADCAST_STREAK_MODES = new Set(['gte', 'zero']);
const BROADCAST_MESSAGE_MAX_LEN = 4096;
const BROADCAST_MESSAGE_KINDS = new Set(['text', 'photo', 'video']);
const BROADCAST_CAPTION_MAX_LEN = 1024;
const BROADCAST_MEDIA_URL_MAX_LEN = 2048;
const BROADCAST_MEDIA_FILE_ID_MAX_LEN = 512;
const BROADCAST_MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const BROADCAST_INLINE_KEYBOARD_MAX_ROWS = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN = 2048;

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

function parseBotKeysField(raw) {
  if (Array.isArray(raw)) {
    const normalized = raw.map((v) => normalizeBotKey(v)).filter(Boolean);
    return Array.from(new Set(normalized));
  }
  const text = (raw ?? '').toString().trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const normalized = parsed.map((v) => normalizeBotKey(v)).filter(Boolean);
      return Array.from(new Set(normalized));
    }
  } catch {
    // ignore
  }
  const normalized = text
    .split(',')
    .map((v) => normalizeBotKey(v))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function baseLanguageForBotKey(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return null;
  const botMeta = publicBotMetaForKey(botKey);
  return normalizeLanguageCode(botMeta?.base_language || botKey.split('-')[0] || '');
}

function validateBroadcastBotSelection(botKeysRaw) {
  const botKeys = Array.isArray(botKeysRaw)
    ? Array.from(new Set(botKeysRaw.map((v) => normalizeBotKey(v)).filter(Boolean)))
    : [];

  if (botKeys.length === 0) {
    return { ok: false, error: 'bot_selection_required' };
  }

  const baseLanguages = [];
  for (const botKey of botKeys) {
    const baseLanguage = baseLanguageForBotKey(botKey);
    if (!baseLanguage) {
      return { ok: false, error: 'invalid_bot_selection' };
    }
    baseLanguages.push(baseLanguage);
  }

  const uniqueBaseLanguages = Array.from(new Set(baseLanguages));
  if (uniqueBaseLanguages.length !== 1) {
    return { ok: false, error: 'mixed_base_languages_not_allowed' };
  }

  return {
    ok: true,
    botKeys,
    baseLanguage: uniqueBaseLanguages[0]
  };
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
        .map((v) => v.toString().trim().toLowerCase())
        .filter((v) => BROADCAST_ALLOWED_TIERS.has(v))
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
        .map((v) => normalizeBotKey(v))
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

function withBroadcastStreakRange(filters, range) {
  if (!filters?.streakMode) return filters;
  return {
    ...filters,
    streakRange: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      tz: 'UTC'
    }
  };
}

async function getBroadcastAudiencePreview(filters, range, sampleLimit = 20) {
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
    count: countRes.rows[0]?.count || 0,
    sample: sampleRes.rows || []
  };
}

async function listBroadcastRecipients(filters, range, limit) {
  const params = broadcastAudienceParams(filters, range);
  const query = broadcastAudienceSql(
    `f.chat_id,
     f.username,
     f.first_name,
     f.bot_key`,
    'ORDER BY f.chat_id ASC, f.bot_key ASC LIMIT $13::int'
  );
  const { rows } = await pool.query(query, [...params, limit]);
  return rows;
}

function sanitizeErrorText(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;
  return raw.slice(0, 500);
}

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

async function sendTelegramTextMessage(chatId, text, { botKey = null, replyToMessageId = null, parseMode = null, replyMarkup = null } = {}) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

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
  const replyMessageId = Number(replyToMessageId);
  if (Number.isFinite(replyMessageId) && replyMessageId > 0) {
    body.reply_to_message_id = replyMessageId;
    body.allow_sending_without_reply = true;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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

async function sendTelegramPhotoMessage(chatId, photo, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

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

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
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

async function sendTelegramVideoMessage(chatId, video, caption, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

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

  const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
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

async function uploadTelegramMediaToChat({ chatId, messageKind, buffer, filename, mimeType, botKey = null }) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

  const kind = (messageKind ?? '').toString().trim().toLowerCase();
  const method = kind === 'photo' ? 'sendPhoto' : kind === 'video' ? 'sendVideo' : '';
  const field = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : '';
  if (!method || !field) {
    const err = new Error('bad_message_kind');
    err.code = 'bad_message_kind';
    throw err;
  }

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('disable_notification', 'true');
  if (kind === 'video') form.append('supports_streaming', 'true');

  const safeName = (filename ?? '').toString().trim() || (kind === 'photo' ? 'broadcast.jpg' : 'broadcast.mp4');
  const blobType = (mimeType ?? '').toString().trim() || 'application/octet-stream';
  const blob = new Blob([buffer], { type: blobType });
  form.append(field, blob, safeName);

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: form
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

  const result = payload.result || null;
  let fileId = null;
  if (kind === 'photo') {
    const sizes = Array.isArray(result?.photo) ? result.photo : [];
    const largest = sizes.length ? sizes[sizes.length - 1] : null;
    fileId = (largest?.file_id ?? '').toString().trim() || null;
  } else if (kind === 'video') {
    fileId = (result?.video?.file_id ?? '').toString().trim() || null;
  }

  if (!fileId) {
    const err = new Error('telegram_missing_file_id');
    err.code = 'telegram_missing_file_id';
    throw err;
  }

  return { messageId: result?.message_id ?? null, fileId };
}

app.get('/admin/metrics/summary', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH filtered AS (
     SELECT
       chat_id,
       created_at,
       EXISTS (
         SELECT 1
         FROM user_bots ub
         WHERE ub.chat_id = users.chat_id
           AND COALESCE(ub.is_active, true) = true
       ) AS is_active,
       CASE
         WHEN override_plan_tier IS NOT NULL AND override_expires_at IS NOT NULL AND NOW() < override_expires_at
           THEN override_plan_tier
         WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
           THEN plan_tier
           ELSE 'free'
         END AS effective_tier
       FROM users
       WHERE ($1::text IS NULL OR acquisition_start_payload = $1)
         AND ($2::bigint[] IS NULL OR chat_id <> ALL($2::bigint[]))
     )
     SELECT
       COUNT(*)::int AS total_users_all_time,
       SUM((is_active)::int)::int AS active_users_all_time,
       SUM((NOT is_active)::int)::int AS inactive_users_all_time,
       SUM((effective_tier = 'plus')::int)::int AS plus_users_all_time,
       SUM((effective_tier = 'pro')::int)::int AS pro_users_all_time,
       COUNT(*) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS total_users_in_range,
       SUM((is_active)::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS active_users_in_range,
       SUM((NOT is_active)::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS inactive_users_in_range,
       SUM((effective_tier = 'plus')::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS plus_users_in_range,
       SUM((effective_tier = 'pro')::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS pro_users_in_range
     FROM filtered`,
    [range.payload, excludeChatIds, range.from.toISOString(), range.to.toISOString()]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    totals: rows[0] || {
      total_users_all_time: 0,
      active_users_all_time: 0,
      inactive_users_all_time: 0,
      plus_users_all_time: 0,
      pro_users_all_time: 0,
      total_users_in_range: 0,
      active_users_in_range: 0,
      inactive_users_in_range: 0,
      plus_users_in_range: 0,
      pro_users_in_range: 0
    }
  });
});

app.get('/admin/metrics/new-users-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     counts AS (
       SELECT
         date_trunc('day', u.created_at AT TIME ZONE 'UTC')::date AS day_utc,
         COUNT(*)::int AS count
       FROM users u, params
       WHERE u.created_at >= (SELECT from_ts FROM params)
         AND u.created_at < (SELECT to_ts FROM params)
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
       GROUP BY 1
     )
     SELECT d.day_utc::text AS day, COALESCE(c.count, 0)::int AS count
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/new-users-by-day-by-bot', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     new_users AS (
       SELECT
         u.chat_id,
         date_trunc('day', u.created_at AT TIME ZONE 'UTC')::date AS day_utc
       FROM users u, params
       WHERE u.created_at >= (SELECT from_ts FROM params)
         AND u.created_at < (SELECT to_ts FROM params)
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
     ),
     first_bot AS (
       SELECT
         nu.chat_id,
         nu.day_utc,
         COALESCE(ub.bot_key, 'unknown') AS bot_key
       FROM new_users nu
       LEFT JOIN LATERAL (
         SELECT b.bot_key
         FROM user_bots b
         WHERE b.chat_id = nu.chat_id
         ORDER BY COALESCE(b.first_seen_at, b.created_at) ASC, b.bot_key ASC
         LIMIT 1
       ) ub ON true
     ),
     counts AS (
       SELECT
         fb.day_utc,
         fb.bot_key,
         COUNT(*)::int AS count
       FROM first_bot fb
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       bots.bot_key,
       COALESCE(c.count, 0)::int AS count
     FROM days d
     CROSS JOIN (SELECT DISTINCT bot_key FROM counts) bots
     LEFT JOIN counts c ON c.day_utc = d.day_utc AND c.bot_key = bots.bot_key
     ORDER BY d.day_utc ASC, bots.bot_key ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/new-paid-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id, plan_started_at, plan_started_tier
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     counts AS (
       SELECT
         date_trunc('day', u.plan_started_at AT TIME ZONE 'UTC')::date AS day_utc,
         u.plan_started_tier AS tier,
         COUNT(*)::int AS count
       FROM filtered_users u, params
       WHERE u.plan_started_at IS NOT NULL
         AND u.plan_started_at >= (SELECT from_ts FROM params)
         AND u.plan_started_at < (SELECT to_ts FROM params)
         AND u.plan_started_tier IN ('plus', 'pro')
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       COALESCE(SUM(c.count) FILTER (WHERE c.tier = 'plus'), 0)::int AS plus,
       COALESCE(SUM(c.count) FILTER (WHERE c.tier = 'pro'), 0)::int AS pro
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     GROUP BY d.day_utc
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/active-users-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     counts AS (
       SELECT
         date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         COUNT(DISTINCT v.chat_id)::int AS count
       FROM voice_usage_events v
       JOIN filtered_users u ON u.chat_id = v.chat_id
       WHERE v.occurred_at >= (SELECT from_ts FROM params)
         AND v.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1
     )
     SELECT d.day_utc::text AS day, COALESCE(c.count, 0)::int AS count
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/user-streaks', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     activity_days AS (
       SELECT DISTINCT activity.chat_id, activity.day_utc
       FROM (
         SELECT
           v.chat_id,
           date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc
         FROM voice_usage_events v
         WHERE v.occurred_at >= (SELECT from_ts FROM params)
           AND v.occurred_at < (SELECT to_ts FROM params)

         UNION

         SELECT
           m.chat_id,
           date_trunc('day', m.created_at AT TIME ZONE 'UTC')::date AS day_utc
         FROM messages m
         WHERE m.role = 'user'
           AND m.created_at >= (SELECT from_ts FROM params)
           AND m.created_at < (SELECT to_ts FROM params)
       ) activity
       JOIN filtered_users u ON u.chat_id = activity.chat_id
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
     )
     SELECT
       streak_days::text AS day,
       COUNT(*)::int AS users
     FROM max_streaks
     GROUP BY streak_days
     ORDER BY streak_days ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/active-users-by-day-by-bot', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     counts AS (
       SELECT
         date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         v.bot_key,
         COUNT(DISTINCT v.chat_id)::int AS count
       FROM voice_usage_events v
       JOIN filtered_users u ON u.chat_id = v.chat_id
       WHERE v.occurred_at >= (SELECT from_ts FROM params)
         AND v.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       c.bot_key,
       COALESCE(c.count, 0)::int AS count
     FROM days d
     CROSS JOIN (SELECT DISTINCT bot_key FROM counts) bots
     LEFT JOIN counts c ON c.day_utc = d.day_utc AND c.bot_key = bots.bot_key
     ORDER BY d.day_utc ASC, bots.bot_key ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/inactive-users-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     counts AS (
       SELECT
         date_trunc('day', u.inactive_at AT TIME ZONE 'UTC')::date AS day_utc,
         COUNT(*)::int AS count
       FROM users u, params
       WHERE u.inactive_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM user_bots ub
           WHERE ub.chat_id = u.chat_id
             AND COALESCE(ub.is_active, true) = true
         )
         AND u.inactive_at >= (SELECT from_ts FROM params)
         AND u.inactive_at < (SELECT to_ts FROM params)
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
       GROUP BY 1
     )
     SELECT d.day_utc::text AS day, COALESCE(c.count, 0)::int AS count
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/usage-seconds-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     sums AS (
       SELECT
         date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         v.direction AS direction,
         SUM(v.seconds)::bigint AS seconds
       FROM voice_usage_events v
       JOIN filtered_users u ON u.chat_id = v.chat_id
       WHERE v.occurred_at >= (SELECT from_ts FROM params)
         AND v.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       COALESCE(SUM(s.seconds) FILTER (WHERE s.direction = 'in'), 0)::bigint AS in_seconds,
       COALESCE(SUM(s.seconds) FILTER (WHERE s.direction = 'out'), 0)::bigint AS out_seconds
     FROM days d
     LEFT JOIN sums s USING (day_utc)
     GROUP BY d.day_utc
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/xp-earned-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     earned AS (
       SELECT
         date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         SUM(e.xp_delta)::bigint AS xp,
         COUNT(DISTINCT e.chat_id)::int AS users
       FROM xp_events e
       JOIN filtered_users u ON u.chat_id = e.chat_id
       WHERE e.occurred_at >= (SELECT from_ts FROM params)
         AND e.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1
     )
     SELECT
       d.day_utc::text AS day,
       COALESCE(er.xp, 0)::bigint AS xp,
       COALESCE(er.users, 0)::int AS users
     FROM days d
     LEFT JOIN earned er USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/xp-distribution', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($1::text IS NULL OR acquisition_start_payload = $1)
         AND ($2::bigint[] IS NULL OR chat_id <> ALL($2::bigint[]))
     ),
     per_user AS (
       SELECT
         u.chat_id,
         COALESCE(SUM(up.xp_total), 0)::int AS xp_total
       FROM filtered_users u
       LEFT JOIN user_progress up ON up.chat_id = u.chat_id
       GROUP BY u.chat_id
     ),
     labeled AS (
       SELECT
         CASE
           WHEN xp_total <= 49 THEN '0–49'
           WHEN xp_total <= 99 THEN '50–99'
           WHEN xp_total <= 199 THEN '100–199'
           WHEN xp_total <= 499 THEN '200–499'
           WHEN xp_total <= 999 THEN '500–999'
           WHEN xp_total <= 1999 THEN '1k–1.9k'
           WHEN xp_total <= 4999 THEN '2k–4.9k'
           WHEN xp_total <= 9999 THEN '5k–9.9k'
           ELSE '10k+'
         END AS bucket,
         COUNT(*)::int AS users
       FROM per_user
       GROUP BY 1
     ),
     buckets AS (
       SELECT *
       FROM (
         VALUES
           (1, '0–49'),
           (2, '50–99'),
           (3, '100–199'),
           (4, '200–499'),
           (5, '500–999'),
           (6, '1k–1.9k'),
           (7, '2k–4.9k'),
           (8, '5k–9.9k'),
           (9, '10k+')
       ) AS b(ord, bucket)
     )
     SELECT
       b.bucket AS day,
       COALESCE(l.users, 0)::int AS users
     FROM buckets b
     LEFT JOIN labeled l ON l.bucket = b.bucket
     ORDER BY b.ord ASC`,
    [range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/free-users-insights', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const params = [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds];

  const [totalsRes, usageBucketsRes, messageBucketsRes] = await Promise.all([
    pool.query(
      `WITH params AS (
         SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
       ),
       free_users AS (
         SELECT u.chat_id
         FROM users u
         WHERE ($3::text IS NULL OR u.acquisition_start_payload = $3)
           AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
           AND EXISTS (
             SELECT 1
             FROM user_bots ub
             WHERE ub.chat_id = u.chat_id
               AND COALESCE(ub.is_active, true) = true
           )
           AND CASE
             WHEN u.override_plan_tier IS NOT NULL AND u.override_expires_at IS NOT NULL AND NOW() < u.override_expires_at
               THEN u.override_plan_tier
             WHEN u.plan_expires_at IS NOT NULL AND NOW() < u.plan_expires_at
               THEN u.plan_tier
             ELSE 'free'
           END = 'free'
       ),
       usage_per_user AS (
         SELECT
           f.chat_id,
           COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'in'), 0)::bigint AS in_seconds,
           COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'out'), 0)::bigint AS out_seconds
         FROM free_users f
         LEFT JOIN voice_usage_events v
           ON v.chat_id = f.chat_id
          AND v.occurred_at >= (SELECT from_ts FROM params)
          AND v.occurred_at < (SELECT to_ts FROM params)
         GROUP BY f.chat_id
       ),
       message_per_user AS (
         SELECT
           f.chat_id,
           COUNT(*) FILTER (WHERE m.role = 'user')::int AS sent_messages,
           COUNT(*) FILTER (WHERE m.role = 'assistant')::int AS assistant_messages
         FROM free_users f
         LEFT JOIN messages m
           ON m.chat_id = f.chat_id
          AND m.created_at >= (SELECT from_ts FROM params)
          AND m.created_at < (SELECT to_ts FROM params)
         GROUP BY f.chat_id
       )
       SELECT
         (SELECT COUNT(*) FROM free_users)::int AS free_users_all_time,
         COUNT(*) FILTER (WHERE (u.in_seconds + u.out_seconds) > 0)::int AS free_users_with_voice_in_range,
         COUNT(*) FILTER (WHERE m.sent_messages > 0)::int AS free_users_with_messages_in_range,
         COUNT(*) FILTER (WHERE (u.in_seconds + u.out_seconds) > 0 OR m.sent_messages > 0)::int AS engaged_free_users_in_range,
         COALESCE(SUM(u.in_seconds), 0)::bigint AS in_seconds,
         COALESCE(SUM(u.out_seconds), 0)::bigint AS out_seconds,
         COALESCE(SUM(m.sent_messages), 0)::bigint AS sent_messages,
         COALESCE(SUM(m.assistant_messages), 0)::bigint AS assistant_messages
       FROM free_users f
       LEFT JOIN usage_per_user u ON u.chat_id = f.chat_id
       LEFT JOIN message_per_user m ON m.chat_id = f.chat_id`,
      params
    ),
    pool.query(
      `WITH params AS (
         SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
       ),
       free_users AS (
         SELECT u.chat_id
         FROM users u
         WHERE ($3::text IS NULL OR u.acquisition_start_payload = $3)
           AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
           AND EXISTS (
             SELECT 1
             FROM user_bots ub
             WHERE ub.chat_id = u.chat_id
               AND COALESCE(ub.is_active, true) = true
           )
           AND CASE
             WHEN u.override_plan_tier IS NOT NULL AND u.override_expires_at IS NOT NULL AND NOW() < u.override_expires_at
               THEN u.override_plan_tier
             WHEN u.plan_expires_at IS NOT NULL AND NOW() < u.plan_expires_at
               THEN u.plan_tier
             ELSE 'free'
           END = 'free'
       ),
       usage_per_user AS (
         SELECT
           f.chat_id,
           (
             COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'in'), 0)
             + COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'out'), 0)
           )::bigint AS total_seconds
         FROM free_users f
         LEFT JOIN voice_usage_events v
           ON v.chat_id = f.chat_id
          AND v.occurred_at >= (SELECT from_ts FROM params)
          AND v.occurred_at < (SELECT to_ts FROM params)
         GROUP BY f.chat_id
       ),
       buckets AS (
         SELECT *
         FROM (VALUES
           (0::bigint, 30::bigint, '<30s'::text, 1),
           (30::bigint, 60::bigint, '<1m'::text, 2),
           (60::bigint, 120::bigint, '<2m'::text, 3),
           (120::bigint, 300::bigint, '<5m'::text, 4),
           (300::bigint, 600::bigint, '<10m'::text, 5),
           (600::bigint, NULL::bigint, '10m+'::text, 6)
         ) AS t(min_seconds, max_seconds, label, ord)
       )
       SELECT
         b.label AS day,
         COUNT(*) FILTER (
           WHERE u.total_seconds > 0
             AND u.total_seconds >= b.min_seconds
             AND (b.max_seconds IS NULL OR u.total_seconds < b.max_seconds)
         )::int AS users
       FROM buckets b
       LEFT JOIN usage_per_user u ON true
       GROUP BY b.label, b.ord
       ORDER BY b.ord ASC`,
      params
    ),
    pool.query(
      `WITH params AS (
         SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
       ),
       free_users AS (
         SELECT u.chat_id
         FROM users u
         WHERE ($3::text IS NULL OR u.acquisition_start_payload = $3)
           AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
           AND EXISTS (
             SELECT 1
             FROM user_bots ub
             WHERE ub.chat_id = u.chat_id
               AND COALESCE(ub.is_active, true) = true
           )
           AND CASE
             WHEN u.override_plan_tier IS NOT NULL AND u.override_expires_at IS NOT NULL AND NOW() < u.override_expires_at
               THEN u.override_plan_tier
             WHEN u.plan_expires_at IS NOT NULL AND NOW() < u.plan_expires_at
               THEN u.plan_tier
             ELSE 'free'
           END = 'free'
       ),
       message_per_user AS (
         SELECT
           f.chat_id,
           COUNT(*) FILTER (WHERE m.role = 'user')::int AS sent_messages
         FROM free_users f
         LEFT JOIN messages m
           ON m.chat_id = f.chat_id
          AND m.created_at >= (SELECT from_ts FROM params)
          AND m.created_at < (SELECT to_ts FROM params)
         GROUP BY f.chat_id
       ),
       buckets AS (
         SELECT *
         FROM (VALUES
           (1::int, 2::int, '1'::text, 1),
           (2::int, 4::int, '2-3'::text, 2),
           (4::int, 8::int, '4-7'::text, 3),
           (8::int, 16::int, '8-15'::text, 4),
           (16::int, 31::int, '16-30'::text, 5),
           (31::int, NULL::int, '31+'::text, 6)
         ) AS t(min_messages, max_messages, label, ord)
       )
       SELECT
         b.label AS day,
         COUNT(*) FILTER (
           WHERE m.sent_messages >= b.min_messages
             AND (b.max_messages IS NULL OR m.sent_messages < b.max_messages)
         )::int AS users
       FROM buckets b
       LEFT JOIN message_per_user m ON true
       GROUP BY b.label, b.ord
       ORDER BY b.ord ASC`,
      params
    )
  ]);

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    totals: totalsRes.rows[0] || {
      free_users_all_time: 0,
      free_users_with_voice_in_range: 0,
      free_users_with_messages_in_range: 0,
      engaged_free_users_in_range: 0,
      in_seconds: 0,
      out_seconds: 0,
      sent_messages: 0,
      assistant_messages: 0
    },
    usage_buckets: usageBucketsRes.rows || [],
    message_buckets: messageBucketsRes.rows || []
  });
});

app.get('/admin/metrics/active-users-by-hour', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     hours AS (
       SELECT generate_series(0, 23)::int AS hour_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     counts AS (
       SELECT
         EXTRACT(HOUR FROM v.occurred_at AT TIME ZONE 'UTC')::int AS hour_utc,
         COUNT(DISTINCT v.chat_id)::int AS count
       FROM voice_usage_events v
       JOIN filtered_users u ON u.chat_id = v.chat_id
       WHERE v.occurred_at >= (SELECT from_ts FROM params)
         AND v.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1
     )
     SELECT
       LPAD(h.hour_utc::text, 2, '0') || ':00' AS day,
       COALESCE(c.count, 0)::int AS count
     FROM hours h
     LEFT JOIN counts c USING (hour_utc)
     ORDER BY h.hour_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/active-users-by-hour-today', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + DAY_MS);
  const payloadRaw = (req.query.payload ?? '').toString().trim();
  const payload = payloadRaw ? payloadRaw.slice(0, 200) : null;
  const excludeChatIds = parseChatIdList(req.query.exclude_chat_ids ?? req.query.excludeChatIds);
  const excludeChatIdsParam = excludeChatIds.length ? excludeChatIds : null;

  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     hours AS (
       SELECT generate_series(0, 23)::int AS hour_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     voice_stats AS (
       SELECT
         EXTRACT(HOUR FROM v.occurred_at AT TIME ZONE 'UTC')::int AS hour_utc,
         COUNT(DISTINCT v.chat_id)::int AS count,
         COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'in'), 0)::bigint AS in_seconds,
         COALESCE(SUM(v.seconds) FILTER (WHERE v.direction = 'out'), 0)::bigint AS out_seconds
       FROM voice_usage_events v
       JOIN filtered_users u ON u.chat_id = v.chat_id
       WHERE v.occurred_at >= (SELECT from_ts FROM params)
         AND v.occurred_at < (SELECT to_ts FROM params)
       GROUP BY 1
     ),
     message_stats AS (
       SELECT
         EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'UTC')::int AS hour_utc,
         COUNT(*)::int AS message_count
       FROM messages m
       JOIN filtered_users u ON u.chat_id = m.chat_id
       WHERE m.created_at >= (SELECT from_ts FROM params)
         AND m.created_at < (SELECT to_ts FROM params)
       GROUP BY 1
     )
     SELECT
       LPAD(h.hour_utc::text, 2, '0') || ':00' AS day,
       COALESCE(vs.count, 0)::int AS count,
       COALESCE(vs.in_seconds, 0)::bigint AS in_seconds,
       COALESCE(vs.out_seconds, 0)::bigint AS out_seconds,
       COALESCE(ms.message_count, 0)::int AS message_count
     FROM hours h
     LEFT JOIN voice_stats vs USING (hour_utc)
     LEFT JOIN message_stats ms USING (hour_utc)
     ORDER BY h.hour_utc ASC`,
    [from.toISOString(), to.toISOString(), payload, excludeChatIdsParam]
  );

  return res.json({
    tz: 'UTC',
    from: from.toISOString(),
    to: to.toISOString(),
    payload,
    series: rows
  });
});

app.get('/admin/metrics/bot-stats', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const { rows } = await pool.query(
    `SELECT * FROM bot_stats ORDER BY bot_key`
  );

  return res.json({
    bots: rows || []
  });
});

app.get('/admin/metrics/acquisition-payloads', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `SELECT acquisition_start_payload AS payload, COUNT(*)::int AS users
       FROM users
      WHERE acquisition_start_payload IS NOT NULL
        AND created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
        AND ($3::bigint[] IS NULL OR chat_id <> ALL($3::bigint[]))
      GROUP BY acquisition_start_payload
      ORDER BY users DESC
      LIMIT 80`,
    [range.from.toISOString(), range.to.toISOString(), excludeChatIds]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payloads: rows
  });
});

app.get('/admin/metrics/actions-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     counts AS (
       SELECT
         date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         e.action_type,
         COUNT(DISTINCT e.chat_id)::int AS count
       FROM action_events e
       JOIN filtered_users u ON u.chat_id = e.chat_id
       WHERE e.occurred_at >= (SELECT from_ts FROM params)
         AND e.occurred_at < (SELECT to_ts FROM params)
         AND e.action_type = ANY($5::text[])
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'start'), 0)::int AS start,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'profile_set_level'), 0)::int AS profile_set_level,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'first_voice_sent'), 0)::int AS first_voice_sent,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'first_answer_delivered'), 0)::int AS first_answer_delivered,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'topic_set'), 0)::int AS topic_set,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'topic_message_sent'), 0)::int AS topic_message_sent,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'topic_clear'), 0)::int AS topic_clear,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'day1_return'), 0)::int AS day1_return,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'paywall_shown'), 0)::int AS paywall_shown,
       COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'purchase_success'), 0)::int AS purchase_success
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     GROUP BY d.day_utc
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, ACTION_EVENT_TYPES]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/topics-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH params AS (
       SELECT $1::timestamptz AS from_ts, $2::timestamptz AS to_ts
     ),
     days AS (
       SELECT generate_series(
         date_trunc('day', (SELECT from_ts FROM params) AT TIME ZONE 'UTC'),
         date_trunc('day', ((SELECT to_ts FROM params) - interval '1 millisecond') AT TIME ZONE 'UTC'),
         interval '1 day'
       )::date AS day_utc
     ),
     filtered_users AS (
       SELECT chat_id
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     topic_ids AS (
       SELECT DISTINCT NULLIF(BTRIM(e.properties->>'topic_id'), '') AS topic_id
       FROM action_events e
       JOIN filtered_users u ON u.chat_id = e.chat_id
       WHERE e.occurred_at >= (SELECT from_ts FROM params)
         AND e.occurred_at < (SELECT to_ts FROM params)
         AND e.action_type = ANY($5::text[])
         AND NULLIF(BTRIM(e.properties->>'topic_id'), '') IS NOT NULL
     ),
     counts AS (
       SELECT
         date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         NULLIF(BTRIM(e.properties->>'topic_id'), '') AS topic_id,
         COUNT(DISTINCT e.chat_id)::int AS count
       FROM action_events e
       JOIN filtered_users u ON u.chat_id = e.chat_id
       WHERE e.occurred_at >= (SELECT from_ts FROM params)
         AND e.occurred_at < (SELECT to_ts FROM params)
         AND e.action_type = ANY($5::text[])
         AND NULLIF(BTRIM(e.properties->>'topic_id'), '') IS NOT NULL
       GROUP BY 1, 2
     )
     SELECT
       d.day_utc::text AS day,
       t.topic_id,
       COALESCE(c.count, 0)::int AS count
     FROM days d
     CROSS JOIN topic_ids t
     LEFT JOIN counts c
       ON c.day_utc = d.day_utc
      AND c.topic_id = t.topic_id
     ORDER BY d.day_utc ASC, t.topic_id ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, TOPIC_USAGE_ACTION_TYPES]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/action-totals', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const { rows } = await pool.query(
    `WITH filtered_users AS (
       SELECT chat_id, created_at
       FROM users
       WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
     ),
     action_types AS (
       SELECT unnest($5::text[]) AS action_type
     ),
     counts AS (
       SELECT
         'start'::text AS action_type,
         COUNT(DISTINCT u.chat_id)::int AS count
       FROM filtered_users u
       WHERE u.created_at >= $1::timestamptz
         AND u.created_at < $2::timestamptz

       UNION ALL

       SELECT
         e.action_type,
         COUNT(DISTINCT e.chat_id)::int AS count
       FROM action_events e
       JOIN filtered_users u ON u.chat_id = e.chat_id
       WHERE e.occurred_at >= $1::timestamptz
         AND e.occurred_at < $2::timestamptz
         AND e.action_type = ANY($5::text[])
         AND e.action_type <> 'start'
       GROUP BY e.action_type
     )
     SELECT
       a.action_type AS action,
       COALESCE(c.count, 0)::int AS count
     FROM action_types a
     LEFT JOIN counts c ON c.action_type = a.action_type
     ORDER BY array_position($5::text[], a.action_type) ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, ACTION_EVENT_TYPES]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/action-funnel', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
  const funnelActionTypes = [
    'first_voice_sent',
    'paywall_shown'
  ];

  const { rows } = await pool.query(
    `WITH cohort AS (
       SELECT
         u.chat_id,
         u.created_at AS start_at
       FROM users u
       WHERE u.created_at >= $1::timestamptz
         AND u.created_at < $2::timestamptz
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3)
         AND ($4::bigint[] IS NULL OR u.chat_id <> ALL($4::bigint[]))
     ),
     free_plan AS (
       SELECT COALESCE(p.voice_seconds_limit, 0)::int AS limit_seconds
       FROM plans p
       WHERE p.tier = 'free'
       LIMIT 1
     ),
     per_user AS (
       SELECT
         c.chat_id,
         c.start_at,
         MIN(e.occurred_at) FILTER (WHERE e.action_type = 'first_voice_sent') AS first_message_at,
         onboarding.onboarding_complete_at,
         COALESCE(usage.used_total, 0)::int AS used_total,
         MIN(e.occurred_at) FILTER (WHERE e.action_type = 'paywall_shown') AS paywall_shown_at
       FROM cohort c
       LEFT JOIN action_events e
         ON e.chat_id = c.chat_id
        AND e.action_type = ANY($5::text[])
        AND e.occurred_at >= c.start_at
       LEFT JOIN LATERAL (
         SELECT MIN(std.sent_at) AS onboarding_complete_at
         FROM scheduled_task_dispatches std
         WHERE std.chat_id = c.chat_id
           AND std.task_type = 'onboarding_complete'
           AND std.status = 'sent'
           AND std.sent_at IS NOT NULL
       ) onboarding ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(uh.in_voice_seconds + uh.out_voice_seconds), 0)::int AS used_total
         FROM usage_hourly uh
         WHERE uh.chat_id = c.chat_id
       ) usage ON true
       GROUP BY c.chat_id, c.start_at, onboarding.onboarding_complete_at, usage.used_total
     ),
     counts AS (
       SELECT
         COUNT(*)::int AS start_count,
         SUM(
           CASE
             WHEN first_message_at IS NOT NULL
               THEN 1
             ELSE 0
           END
         )::int AS first_message_count,
         SUM(
           CASE
             WHEN first_message_at IS NOT NULL
              AND onboarding_complete_at IS NOT NULL
              AND onboarding_complete_at >= first_message_at
               THEN 1
             ELSE 0
           END
         )::int AS onboarding_complete_count,
         SUM(
           CASE
             WHEN first_message_at IS NOT NULL
              AND onboarding_complete_at IS NOT NULL
              AND onboarding_complete_at >= first_message_at
              AND (SELECT limit_seconds FROM free_plan) > 0
              AND used_total >= ((SELECT limit_seconds FROM free_plan)::numeric * 0.5)
               THEN 1
             ELSE 0
           END
         )::int AS free_limit_half_count,
         SUM(
           CASE
             WHEN first_message_at IS NOT NULL
              AND onboarding_complete_at IS NOT NULL
              AND onboarding_complete_at >= first_message_at
              AND (SELECT limit_seconds FROM free_plan) > 0
              AND used_total >= ((SELECT limit_seconds FROM free_plan)::numeric * 0.5)
              AND paywall_shown_at IS NOT NULL
              AND paywall_shown_at >= onboarding_complete_at
               THEN 1
             ELSE 0
           END
         )::int AS paywall_shown_count
       FROM per_user
     )
     SELECT * FROM counts`,
    [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, funnelActionTypes]
  );

  const row = rows[0] || {};
  const startCount = Number(row.start_count || 0);
  const firstMessageCount = Number(row.first_message_count || 0);
  const onboardingCompleteCount = Number(row.onboarding_complete_count || 0);
  const freeLimitHalfCount = Number(row.free_limit_half_count || 0);
  const paywallShownCount = Number(row.paywall_shown_count || 0);

  function pct(count) {
    if (!startCount) return 0;
    const raw = (Number(count || 0) / startCount) * 100;
    return Math.round(raw * 100) / 100;
  }

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: [
      { action: 'start', count: startCount, pct: startCount ? 100 : 0 },
      { action: 'first_message', count: firstMessageCount, pct: pct(firstMessageCount) },
      { action: 'onboarding_complete', count: onboardingCompleteCount, pct: pct(onboardingCompleteCount) },
      { action: 'free_limit_half', count: freeLimitHalfCount, pct: pct(freeLimitHalfCount) },
      { action: 'paywall_shown', count: paywallShownCount, pct: pct(paywallShownCount) }
    ]
  });
});

app.get('/admin/stripe/product-prices', requireAdmin, async (req, res) => {
  try {
    const productId = getStripeBillingProductId();
    const snapshot = await loadAdminBillingSnapshot(productId);
    return res.json(snapshot);
  } catch (err) {
    console.error('Admin Stripe product prices list failed', err);
    return billingRouteErrorResponse(res, err, 500);
  }
});

app.post('/admin/stripe/product-prices', requireAdmin, async (req, res) => {
  const currency = normalizeCurrencyCode(req.body?.currency);
  const billingInterval = normalizeBillingInterval(req.body?.billing_interval, null);
  const amountCents = parsePositiveInteger(req.body?.amount_cents);

  if (!currency) {
    return res.status(400).json({ error: 'bad_currency' });
  }
  if (!billingInterval) {
    return res.status(400).json({ error: 'bad_billing_interval' });
  }
  if (amountCents === null) {
    return res.status(400).json({ error: 'bad_amount_cents' });
  }

  try {
    const productId = getStripeBillingProductId();
    const runtimeCurrency = normalizeRuntimeCurrencyCode(currency);
    const { rows: existingRows } = await pool.query(
      `SELECT id, stripe_price_id
         FROM plan_prices
        WHERE tier = 'pro'
          AND currency = $1
          AND billing_interval = $2
        LIMIT 1`,
      [runtimeCurrency, billingInterval]
    );

    if (existingRows[0]?.id) {
      return res.status(409).json({
        error: 'runtime_price_exists',
        detail: 'A runtime price already exists for this currency and billing interval.',
        existing: {
          currency,
          billing_interval: billingInterval,
          stripe_price_id: existingRows[0].stripe_price_id || null
        }
      });
    }

    const created = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: amountCents,
      recurring: { interval: billingInterval }
    });

    await pool.query(
      `INSERT INTO plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
       VALUES ('pro', $1, $2, $3, $4, true)`,
      [runtimeCurrency, amountCents, billingInterval, created.id]
    );

    return res.json({
      product_id: productId,
      price: summarizeBillingEntry({
        currency,
        billing_interval: billingInterval,
        stripe_price_id: created.id,
        amount_cents: amountCents
      })
    });
  } catch (err) {
    console.error('Admin Stripe product price create failed', err);
    if (err?.code === '23505') {
      return res.status(409).json({
        error: 'runtime_price_exists',
        detail: 'A runtime price already exists for this currency and billing interval.'
      });
    }
    return billingRouteErrorResponse(res, err, 500);
  }
});

app.post('/admin/stripe/product-prices/:id/replace', requireAdmin, async (req, res) => {
  const priceId = String(req.params.id || '').trim();
  const amountCents = parsePositiveInteger(req.body?.amount_cents);

  if (!priceId) {
    return res.status(400).json({ error: 'bad_price_id' });
  }
  if (amountCents === null) {
    return res.status(400).json({ error: 'bad_amount_cents' });
  }

  try {
    const productId = getStripeBillingProductId();
    const { normalized } = await getManagedStripePrice(priceId, productId);
    const runtimeCurrency = normalizeRuntimeCurrencyCode(normalized.currency);
    const { rows: runtimeRows } = await pool.query(
      `SELECT id, stripe_price_id
         FROM plan_prices
        WHERE tier = 'pro'
          AND currency = $1
          AND billing_interval = $2
        LIMIT 1`,
      [runtimeCurrency, normalized.billing_interval]
    );

    if (!runtimeRows[0]?.id) {
      return res.status(404).json({
        error: 'runtime_price_not_found',
        detail: 'No runtime plan_prices row exists for this currency and billing interval.'
      });
    }

    const replacement = await stripe.prices.create({
      product: productId,
      currency: normalized.currency,
      unit_amount: amountCents,
      recurring: { interval: normalized.billing_interval }
    });

    await stripe.prices.update(priceId, { active: false });

    await pool.query(
      `UPDATE plan_prices
          SET stripe_price_id = $1,
              amount_cents = $2,
              active = true,
              updated_at = NOW()
        WHERE id = $3`,
      [replacement.id, amountCents, runtimeRows[0].id]
    );

    return res.json({
      product_id: productId,
      previous_price_id: priceId,
      price: summarizeBillingEntry({
        currency: normalized.currency,
        billing_interval: normalized.billing_interval,
        stripe_price_id: replacement.id,
        amount_cents: amountCents
      })
    });
  } catch (err) {
    console.error('Admin Stripe product price replace failed', err);
    return billingRouteErrorResponse(res, err, 500);
  }
});

app.post('/admin/stripe/product-prices/:id/archive', requireAdmin, async (req, res) => {
  const priceId = String(req.params.id || '').trim();
  if (!priceId) {
    return res.status(400).json({ error: 'bad_price_id' });
  }

  try {
    const productId = getStripeBillingProductId();
    const { normalized } = await getManagedStripePrice(priceId, productId);

    await stripe.prices.update(priceId, { active: false });

    const result = await pool.query(
      `DELETE FROM plan_prices
        WHERE tier = 'pro'
          AND stripe_price_id = $1`,
      [priceId]
    );

    return res.json({
      product_id: productId,
      archived_price_id: priceId,
      removed_runtime: result.rowCount > 0,
      price: summarizeBillingEntry({
        currency: normalized.currency,
        billing_interval: normalized.billing_interval,
        stripe_price_id: priceId,
        amount_cents: normalized.amount_cents
      })
    });
  } catch (err) {
    console.error('Admin Stripe product price archive failed', err);
    return billingRouteErrorResponse(res, err, 500);
  }
});

app.post('/admin/stripe/product-prices/sync', requireAdmin, async (req, res) => {
  let client;
  try {
    const productId = getStripeBillingProductId();
    const stripePricesRaw = await listStripeBillingProductPrices(productId);
    const activeStripePrices = stripePricesRaw.filter((price) => {
      if (!price?.active) return false;
      if (price?.type !== 'recurring') return false;
      return Boolean(normalizeBillingInterval(price?.recurring?.interval, null));
    });

    const activeByKey = new Map();
    const conflicts = [];

    for (const price of activeStripePrices) {
      const key = buildBillingPriceKey(price.currency, price.recurring?.interval);
      if (!key) continue;
      if (!activeByKey.has(key)) {
        activeByKey.set(key, []);
      }
      activeByKey.get(key).push(price);
    }

    for (const [key, prices] of activeByKey.entries()) {
      if (prices.length < 2) continue;
      const [currency, billingInterval] = key.split(':');
      conflicts.push({
        currency,
        billing_interval: billingInterval,
        stripe_price_ids: prices.map((price) => price.id)
      });
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'duplicate_active_prices',
        detail: 'Sync requires at most one active Stripe price per currency and billing interval.',
        conflicts
      });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const runtimeRows = await loadRuntimePlanPrices(client);
    const runtimeByKey = new Map();
    for (const row of runtimeRows) {
      const key = buildBillingPriceKey(row.currency, row.billing_interval);
      if (key) runtimeByKey.set(key, row);
    }

    const created = [];
    const updated = [];
    const removed = [];
    const unchanged = [];

    for (const prices of activeByKey.values()) {
      const price = prices[0];
      const normalized = assertManagedStripePrice(price, productId);
      const key = buildBillingPriceKey(normalized.currency, normalized.billing_interval);
      if (!key) continue;

      const runtimeCurrency = normalizeRuntimeCurrencyCode(normalized.currency);
      const existing = runtimeByKey.get(key) || null;

      if (!existing) {
        await client.query(
          `INSERT INTO plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
           VALUES ('pro', $1, $2, $3, $4, true)`,
          [runtimeCurrency, normalized.amount_cents, normalized.billing_interval, price.id]
        );
        created.push(summarizeBillingEntry({
          currency: normalized.currency,
          billing_interval: normalized.billing_interval,
          stripe_price_id: price.id,
          amount_cents: normalized.amount_cents
        }));
        continue;
      }

      const existingAmount = Number(existing.amount_cents || 0);
      const existingPriceId = String(existing.stripe_price_id || '');
      const existingActive = Boolean(existing.active);

      if (
        existingAmount === normalized.amount_cents &&
        existingPriceId === price.id &&
        existingActive
      ) {
        unchanged.push(summarizeBillingEntry({
          currency: normalized.currency,
          billing_interval: normalized.billing_interval,
          stripe_price_id: price.id,
          amount_cents: normalized.amount_cents
        }));
        continue;
      }

      await client.query(
        `UPDATE plan_prices
            SET currency = $1,
                amount_cents = $2,
                billing_interval = $3,
                stripe_price_id = $4,
                active = true,
                updated_at = NOW()
          WHERE id = $5`,
        [runtimeCurrency, normalized.amount_cents, normalized.billing_interval, price.id, existing.id]
      );

      updated.push(summarizeBillingEntry({
        currency: normalized.currency,
        billing_interval: normalized.billing_interval,
        stripe_price_id: price.id,
        amount_cents: normalized.amount_cents
      }));
    }

    const activeKeys = new Set(activeByKey.keys());
    for (const row of runtimeRows) {
      const key = buildBillingPriceKey(row.currency, row.billing_interval);
      if (key && activeKeys.has(key)) continue;

      await client.query(`DELETE FROM plan_prices WHERE id = $1`, [row.id]);
      removed.push(summarizeBillingEntry({
        currency: normalizeCurrencyCode(row.currency),
        billing_interval: row.billing_interval,
        stripe_price_id: row.stripe_price_id,
        amount_cents: Number.isFinite(Number(row.amount_cents)) ? Number(row.amount_cents) : null
      }));
    }

    await client.query('COMMIT');

    return res.json({
      product_id: productId,
      summary: {
        created,
        updated,
        removed,
        unchanged
      }
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Admin Stripe product price sync rollback failed', rollbackErr);
      }
    }
    console.error('Admin Stripe product price sync failed', err);
    return billingRouteErrorResponse(res, err, 500);
  } finally {
    client?.release();
  }
});

app.get('/admin/feedbacks', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const kindRaw = (req.query.kind ?? '').toString().trim().toLowerCase();
  const kind = ['text', 'voice'].includes(kindRaw) ? kindRaw : null;
  const statusRaw = (req.query.status ?? '').toString().trim().toLowerCase();
  const status = ['active', 'archived'].includes(statusRaw) ? statusRaw : null;
  const searchRaw = (req.query.search ?? '').toString().trim();
  const search = searchRaw ? searchRaw.slice(0, 120) : null;
  const limit = clampInteger(req.query.limit, { min: 1, max: 200, fallback: 50 });
  const offset = clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

  const baseParams = [range.from.toISOString(), range.to.toISOString(), kind, search, status];
  const [totalRes, threadsRes] = await Promise.all([
    pool.query(
      `WITH matching_threads AS (
         SELECT DISTINCT
           f.chat_id,
           f.bot_key
         FROM feedback f
         LEFT JOIN feedback_threads ft
           ON ft.chat_id = f.chat_id
          AND ft.bot_key = f.bot_key
         WHERE f.created_at >= $1::timestamptz
           AND f.created_at < $2::timestamptz
           AND ($3::text IS NULL OR f.kind = $3::text)
           AND (
             $4::text IS NULL
             OR f.username ILIKE ('%' || $4::text || '%')
             OR f.first_name ILIKE ('%' || $4::text || '%')
             OR f.feedback_text ILIKE ('%' || $4::text || '%')
             OR f.transcript ILIKE ('%' || $4::text || '%')
             OR f.chat_id::text ILIKE ('%' || $4::text || '%')
             OR f.bot_key ILIKE ('%' || $4::text || '%')
           )
           AND (
             $5::text IS NULL
             OR ($5::text = 'archived' AND ft.archived_at IS NOT NULL)
             OR ($5::text = 'active' AND ft.archived_at IS NULL)
           )
         UNION
         SELECT DISTINCT
           r.chat_id,
           r.bot_key
         FROM feedback_replies r
         LEFT JOIN feedback_threads ft
           ON ft.chat_id = r.chat_id
          AND ft.bot_key = r.bot_key
         WHERE $3::text IS NULL
           AND r.created_at >= $1::timestamptz
           AND r.created_at < $2::timestamptz
           AND (
             $4::text IS NULL
             OR r.message_text ILIKE ('%' || $4::text || '%')
             OR r.created_by ILIKE ('%' || $4::text || '%')
             OR r.chat_id::text ILIKE ('%' || $4::text || '%')
             OR r.bot_key ILIKE ('%' || $4::text || '%')
           )
           AND (
             $5::text IS NULL
             OR ($5::text = 'archived' AND ft.archived_at IS NOT NULL)
             OR ($5::text = 'active' AND ft.archived_at IS NULL)
           )
       )
       SELECT COUNT(*)::int AS total
       FROM matching_threads`,
      baseParams
    ),
    pool.query(
      `WITH matching_activity AS (
         SELECT
           f.chat_id,
           f.bot_key,
           MAX(f.created_at) AS last_matching_message_at
         FROM feedback f
         LEFT JOIN feedback_threads ft
           ON ft.chat_id = f.chat_id
          AND ft.bot_key = f.bot_key
         WHERE f.created_at >= $1::timestamptz
           AND f.created_at < $2::timestamptz
           AND ($3::text IS NULL OR f.kind = $3::text)
           AND (
             $4::text IS NULL
             OR f.username ILIKE ('%' || $4::text || '%')
             OR f.first_name ILIKE ('%' || $4::text || '%')
             OR f.feedback_text ILIKE ('%' || $4::text || '%')
             OR f.transcript ILIKE ('%' || $4::text || '%')
             OR f.chat_id::text ILIKE ('%' || $4::text || '%')
             OR f.bot_key ILIKE ('%' || $4::text || '%')
           )
           AND (
             $5::text IS NULL
             OR ($5::text = 'archived' AND ft.archived_at IS NOT NULL)
             OR ($5::text = 'active' AND ft.archived_at IS NULL)
           )
         GROUP BY f.chat_id, f.bot_key
         UNION ALL
         SELECT
           r.chat_id,
           r.bot_key,
           MAX(r.created_at) AS last_matching_message_at
         FROM feedback_replies r
         LEFT JOIN feedback_threads ft
           ON ft.chat_id = r.chat_id
          AND ft.bot_key = r.bot_key
         WHERE $3::text IS NULL
           AND r.created_at >= $1::timestamptz
           AND r.created_at < $2::timestamptz
           AND (
             $4::text IS NULL
             OR r.message_text ILIKE ('%' || $4::text || '%')
             OR r.created_by ILIKE ('%' || $4::text || '%')
             OR r.chat_id::text ILIKE ('%' || $4::text || '%')
             OR r.bot_key ILIKE ('%' || $4::text || '%')
           )
           AND (
             $5::text IS NULL
             OR ($5::text = 'archived' AND ft.archived_at IS NOT NULL)
             OR ($5::text = 'active' AND ft.archived_at IS NULL)
           )
         GROUP BY r.chat_id, r.bot_key
       ),
       ranked_threads AS (
         SELECT
           m.chat_id,
            m.bot_key,
            MAX(m.last_matching_message_at) AS last_message_at
         FROM matching_activity m
         GROUP BY m.chat_id, m.bot_key
         ORDER BY MAX(m.last_matching_message_at) DESC, m.chat_id DESC, m.bot_key ASC
         LIMIT $6::int
         OFFSET $7::int
       )
       SELECT
         t.chat_id,
         t.bot_key,
         t.last_message_at,
         ft.archived_at,
         ft.archived_by,
         latest_feedback.latest_feedback_id,
         COALESCE(NULLIF(latest_feedback.username, ''), u.username) AS username,
         COALESCE(NULLIF(latest_feedback.first_name, ''), u.first_name) AS first_name
       FROM ranked_threads t
       LEFT JOIN feedback_threads ft
         ON ft.chat_id = t.chat_id
        AND ft.bot_key = t.bot_key
       LEFT JOIN users u
         ON u.chat_id = t.chat_id
       LEFT JOIN LATERAL (
         SELECT
           f.id AS latest_feedback_id,
           f.username,
           f.first_name
         FROM feedback f
         WHERE f.chat_id = t.chat_id
           AND f.bot_key = t.bot_key
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT 1
         ) latest_feedback ON TRUE
       ORDER BY t.last_message_at DESC, t.chat_id DESC, t.bot_key ASC`,
      [...baseParams, limit, offset]
    )
  ]);

  const threads = Array.isArray(threadsRes.rows) ? threadsRes.rows : [];
  const threadChatIds = threads.map((row) => Number(row.chat_id)).filter(Number.isFinite);
  const threadBotKeys = threads.map((row) => normalizeBotKey(row.bot_key) || 'uk-de');

  let messages = [];
  if (threadChatIds.length > 0) {
    const messagesRes = await pool.query(
      `WITH selected_threads AS (
         SELECT *
         FROM UNNEST($3::bigint[], $4::text[]) AS t(chat_id, bot_key)
       ),
       combined_messages AS (
         SELECT
           f.chat_id,
           f.bot_key,
           'user'::text AS sender,
           f.kind,
           f.id,
           f.id AS feedback_id,
           f.created_at,
           f.username,
           f.first_name,
           NULL::text AS created_by,
           f.message_id,
           NULL::bigint AS telegram_message_id,
           f.telegram_file_id,
           CASE
             WHEN f.kind = 'voice'
               THEN COALESCE(NULLIF(f.transcript, ''), NULLIF(f.feedback_text, ''), '')
             ELSE COALESCE(f.feedback_text, '')
           END AS body
         FROM feedback f
         INNER JOIN selected_threads t
           ON t.chat_id = f.chat_id
          AND t.bot_key = f.bot_key
         WHERE f.created_at >= $1::timestamptz
           AND f.created_at < $2::timestamptz
         UNION ALL
         SELECT
           r.chat_id,
           r.bot_key,
           'admin'::text AS sender,
           'text'::text AS kind,
           r.id,
           r.feedback_id,
           r.created_at,
           NULL::text AS username,
           NULL::text AS first_name,
           r.created_by,
           NULL::integer AS message_id,
           r.telegram_message_id,
           NULL::text AS telegram_file_id,
           r.message_text AS body
         FROM feedback_replies r
         INNER JOIN selected_threads t
           ON t.chat_id = r.chat_id
          AND t.bot_key = r.bot_key
         WHERE r.created_at >= $1::timestamptz
           AND r.created_at < $2::timestamptz
       )
       SELECT
         m.chat_id,
         m.bot_key,
         m.sender,
         m.kind,
         m.id,
         m.feedback_id,
         m.created_at,
         m.username,
         m.first_name,
         m.created_by,
         m.message_id,
         m.telegram_message_id,
         m.telegram_file_id,
         m.body
       FROM combined_messages m
       ORDER BY
         m.chat_id ASC,
         m.bot_key ASC,
         m.created_at ASC,
         CASE WHEN m.sender = 'user' THEN 0 ELSE 1 END ASC,
         m.id ASC`,
      [range.from.toISOString(), range.to.toISOString(), threadChatIds, threadBotKeys]
    );
    messages = Array.isArray(messagesRes.rows) ? messagesRes.rows : [];
  }

  const threadItems = threads.map((row) => ({
    id: `${row.chat_id}:${row.bot_key}`,
    chat_id: Number(row.chat_id),
    bot_key: row.bot_key,
    username: row.username || null,
    first_name: row.first_name || null,
    archived_at: row.archived_at || null,
    archived_by: row.archived_by || null,
    latest_feedback_id: Number(row.latest_feedback_id || 0) || null,
    first_message_at: null,
    last_message_at: row.last_message_at,
    latest_preview: '',
    message_count: 0,
    user_message_count: 0,
    admin_message_count: 0,
    messages: []
  }));

  const threadMap = new Map(threadItems.map((row) => [row.id, row]));
  for (const row of messages) {
    const key = `${row.chat_id}:${row.bot_key}`;
    const thread = threadMap.get(key);
    if (!thread) continue;

    const body = (row.body ?? '').toString();
    const createdAt = row.created_at;
    thread.messages.push({
      id: `${row.sender}:${row.id}`,
      sender: row.sender,
      kind: row.kind,
      created_at: createdAt,
      feedback_id: row.feedback_id ? Number(row.feedback_id) : null,
      username: row.username || null,
      first_name: row.first_name || null,
      created_by: row.created_by || null,
      message_id: row.message_id ? Number(row.message_id) : null,
      telegram_message_id: row.telegram_message_id ? Number(row.telegram_message_id) : null,
      telegram_file_id: row.telegram_file_id || null,
      body
    });

    if (!thread.first_message_at) thread.first_message_at = createdAt;
    thread.last_message_at = createdAt;
    thread.latest_preview = body;
    thread.message_count += 1;
    if (row.sender === 'admin') thread.admin_message_count += 1;
    else thread.user_message_count += 1;
  }

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    kind,
    status: status || 'all',
    search,
    limit,
    offset,
    total: totalRes.rows[0]?.total || 0,
    items: threadItems
  });
});

function parseAdminFeedbackThreadTarget(body = {}) {
  const chatId = Number(body?.chatId ?? body?.chat_id);
  const botKey = normalizeBotKey(body?.botKey ?? body?.bot_key);
  if (!Number.isFinite(chatId)) return { ok: false, error: 'bad_chat_id' };
  if (!botKey) return { ok: false, error: 'bad_bot_key' };
  return { ok: true, chatId, botKey };
}

function parseAdminChatIdTarget(body = {}) {
  const chatId = Number(body?.chatId ?? body?.chat_id);
  if (!Number.isFinite(chatId)) return { ok: false, error: 'bad_chat_id' };
  return { ok: true, chatId };
}

app.post('/admin/feedbacks/thread/archive', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const target = parseAdminFeedbackThreadTarget(req.body || {});
  if (!target.ok) return res.status(400).json({ error: target.error });

  const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
  const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';

  await pool.query(
    `INSERT INTO feedback_threads (
       chat_id,
       bot_key,
       archived_at,
       archived_by
     )
     VALUES ($1::bigint, $2::text, NOW(), $3::text)
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       archived_at = NOW(),
       archived_by = EXCLUDED.archived_by`,
    [target.chatId, target.botKey, createdBy]
  );

  return res.json({
    ok: true,
    chat_id: target.chatId,
    bot_key: target.botKey,
    archived_at: new Date().toISOString(),
    archived_by: createdBy
  });
});

app.post('/admin/feedbacks/thread/unarchive', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const target = parseAdminFeedbackThreadTarget(req.body || {});
  if (!target.ok) return res.status(400).json({ error: target.error });

  await pool.query(
    `DELETE FROM feedback_threads
     WHERE chat_id = $1::bigint
       AND bot_key = $2::text`,
    [target.chatId, target.botKey]
  );

  return res.json({
    ok: true,
    chat_id: target.chatId,
    bot_key: target.botKey,
    archived_at: null,
    archived_by: null
  });
});

app.post('/admin/feedbacks/thread/delete', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const target = parseAdminFeedbackThreadTarget(req.body || {});
  if (!target.ok) return res.status(400).json({ error: target.error });

  let replyDeleted = 0;
  let feedbackDeleted = 0;
  let metaDeleted = 0;

  await pool.query('BEGIN');
  try {
    const repliesRes = await pool.query(
      `DELETE FROM feedback_replies
       WHERE chat_id = $1::bigint
         AND bot_key = $2::text`,
      [target.chatId, target.botKey]
    );
    replyDeleted = repliesRes.rowCount || 0;

    const feedbackRes = await pool.query(
      `DELETE FROM feedback
       WHERE chat_id = $1::bigint
         AND bot_key = $2::text`,
      [target.chatId, target.botKey]
    );
    feedbackDeleted = feedbackRes.rowCount || 0;

    const metaRes = await pool.query(
      `DELETE FROM feedback_threads
       WHERE chat_id = $1::bigint
         AND bot_key = $2::text`,
      [target.chatId, target.botKey]
    );
    metaDeleted = metaRes.rowCount || 0;

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  if (replyDeleted === 0 && feedbackDeleted === 0 && metaDeleted === 0) {
    return res.status(404).json({ error: 'thread_not_found' });
  }

  return res.json({
    ok: true,
    chat_id: target.chatId,
    bot_key: target.botKey,
    deleted_feedback_count: feedbackDeleted,
    deleted_reply_count: replyDeleted
  });
});

app.post('/admin/feedbacks/:id/reply', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const feedbackId = Number(req.params.id);
  if (!Number.isFinite(feedbackId) || feedbackId <= 0) {
    return res.status(400).json({ error: 'bad_feedback_id' });
  }

  const messageRaw = (req.body?.messageText ?? req.body?.message ?? '').toString();
  const messageText = messageRaw.trim();
  if (!messageText) {
    return res.status(400).json({ error: 'empty_message' });
  }
  if (messageText.length > BROADCAST_MESSAGE_MAX_LEN) {
    return res.status(400).json({
      error: 'message_too_long',
      max_length: BROADCAST_MESSAGE_MAX_LEN
    });
  }
  const replyToFeedbackIdRaw = req.body?.replyToFeedbackId ?? req.body?.reply_to_feedback_id ?? null;
  const replyToFeedbackId = replyToFeedbackIdRaw === null || replyToFeedbackIdRaw === undefined || replyToFeedbackIdRaw === ''
    ? null
    : Number(replyToFeedbackIdRaw);
  if (replyToFeedbackIdRaw !== null && replyToFeedbackIdRaw !== undefined && replyToFeedbackIdRaw !== '') {
    if (!Number.isFinite(replyToFeedbackId) || replyToFeedbackId <= 0) {
      return res.status(400).json({ error: 'bad_reply_to_feedback_id' });
    }
  }

  const { rows } = await pool.query(
    `SELECT
       f.id,
       f.chat_id,
       f.bot_key,
       f.message_id
     FROM feedback f
     WHERE f.id = $1
     LIMIT 1`,
    [feedbackId]
  );
  const feedback = rows[0];
  if (!feedback) return res.status(404).json({ error: 'feedback_not_found' });

  const chatId = Number(feedback.chat_id);
  const botKey = normalizeBotKey(feedback.bot_key) || await resolveUserBotKey(chatId) || null;
  let replyTarget = feedback;

  if (Number.isFinite(replyToFeedbackId) && replyToFeedbackId > 0 && replyToFeedbackId !== feedbackId) {
    const { rows: replyTargetRows } = await pool.query(
      `SELECT
         f.id,
         f.chat_id,
         f.bot_key,
         f.message_id
       FROM feedback f
       WHERE f.id = $1
         AND f.chat_id = $2::bigint
         AND f.bot_key = $3::text
       LIMIT 1`,
      [replyToFeedbackId, chatId, botKey || 'uk-de']
    );
    const target = replyTargetRows[0] || null;
    if (!target) return res.status(404).json({ error: 'reply_target_not_found' });
    replyTarget = target;
  }
  const replyToMessageId = Number(replyTarget?.message_id);

  try {
    const telegramResult = await sendTelegramTextMessage(chatId, messageText, {
      botKey,
      replyToMessageId
    });
    const messageIdRaw = Number(telegramResult?.message_id ?? 0);
    const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;
    const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
    const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';

    const { rows: replyRows } = await pool.query(
      `INSERT INTO feedback_replies (
         feedback_id,
         chat_id,
         bot_key,
         message_text,
         telegram_message_id,
         created_by
       )
       VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::bigint, $6::text)
       RETURNING id, created_at`,
      [replyTarget.id, chatId, botKey || 'uk-de', messageText, telegramMessageId, createdBy]
    );
    const reply = replyRows[0] || null;

    await pool.query(
      `DELETE FROM feedback_threads
       WHERE chat_id = $1::bigint
         AND bot_key = $2::text`,
      [chatId, botKey || 'uk-de']
    );

    await updateUserDeliveryState(chatId, {
      status: 'sent',
      lastError: null,
      inactiveReason: null,
      botKey
    });

    return res.json({
      ok: true,
      feedback_id: replyTarget.id,
      chat_id: chatId,
      bot_key: botKey,
      telegram_message_id: telegramMessageId,
      reply_to_message_id: Number.isFinite(replyToMessageId) && replyToMessageId > 0 ? replyToMessageId : null,
      reply: reply ? {
        id: Number(reply.id || 0) || null,
        sender: 'admin',
        kind: 'text',
        created_at: reply.created_at,
        created_by: createdBy,
        body: messageText,
        telegram_message_id: telegramMessageId,
        reply_to_message_id: Number.isFinite(replyToMessageId) && replyToMessageId > 0 ? replyToMessageId : null
      } : null
    });
  } catch (err) {
    const detail = sanitizeErrorText(err?.message || String(err)) || 'telegram_send_failed';
    const inactiveReason = classifyPermanentTelegramFailure(err);

    await updateUserDeliveryState(chatId, {
      status: 'failed',
      lastError: detail,
      inactiveReason,
      botKey
    });

    return res.status(502).json({
      error: 'telegram_send_failed',
      detail,
      inactive_reason: inactiveReason || null
    });
  }
});

app.get('/admin/users/search', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const raw = (req.query.q ?? '').toString().trim();
  const q = raw.replace(/^@/, '').slice(0, 80);
  const limit = clampInteger(req.query.limit, { min: 1, max: 50, fallback: 10 });

  if (!q) {
    return res.json({ q: '', items: [] });
  }

  const chatId = /^\d{4,20}$/.test(q) ? q : null;

  const { rows } = await pool.query(
    `WITH matches AS (
       SELECT
         u.chat_id,
         u.username,
         u.first_name,
         COALESCE(ub.bot_key, '') AS bot_key,
         COALESCE(ub.last_seen_at, u.updated_at) AS last_seen_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT
           b.bot_key,
           b.last_seen_at
         FROM user_bots b
         WHERE b.chat_id = u.chat_id
         ORDER BY COALESCE(b.last_seen_at, b.updated_at, b.created_at) DESC, b.bot_key ASC
         LIMIT 1
       ) ub ON true
       WHERE (
         ($1::bigint IS NOT NULL AND u.chat_id = $1::bigint)
         OR u.username ILIKE ('%' || $2::text || '%')
         OR u.first_name ILIKE ('%' || $2::text || '%')
         OR u.chat_id::text ILIKE ('%' || $2::text || '%')
       )
     )
     SELECT
       chat_id,
       username,
       first_name,
       NULLIF(bot_key, '') AS bot_key
     FROM matches
     ORDER BY
       (chat_id = $1::bigint) DESC,
       last_seen_at DESC NULLS LAST,
       chat_id DESC
     LIMIT $3::int`,
    [chatId, q, limit]
  );

  return res.json({ q, items: rows || [] });
});

app.post('/admin/users/delete', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const target = parseAdminChatIdTarget(req.body || {});
  if (!target.ok) return res.status(400).json({ error: target.error });

  const client = await pool.connect();
  const deleted = {};
  try {
    await client.query('BEGIN');

    // Keep the user row for last, so all dependent/chat history data is cleared first.
    const deleteTableByChatId = async (tableName) => {
      const result = await client.query(
        `DELETE FROM ${tableName}
         WHERE chat_id = $1::bigint`,
        [target.chatId]
      );
      deleted[tableName] = result.rowCount || 0;
    };

    await deleteTableByChatId('action_events');
    await deleteTableByChatId('broadcast_recipients');
    await deleteTableByChatId('feedback_replies');
    await deleteTableByChatId('feedback');
    await deleteTableByChatId('feedback_threads');
    await deleteTableByChatId('loader_flags');
    await deleteTableByChatId('messages');
    await deleteTableByChatId('payments');
    await deleteTableByChatId('pending_feedback');
    await deleteTableByChatId('usage_hourly');
    await deleteTableByChatId('usage_week');
    await deleteTableByChatId('voice_usage_events');
    await deleteTableByChatId('xp_events');
    await deleteTableByChatId('user_progress');
    await deleteTableByChatId('user_summaries');
    await deleteTableByChatId('user_bots');
    await deleteTableByChatId('users');

    const deletedTotal = Object.values(deleted).reduce((sum, value) => sum + Number(value || 0), 0);
    if (deletedTotal <= 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user_not_found' });
    }

    await client.query('COMMIT');
    return res.json({
      ok: true,
      chat_id: target.chatId,
      deleted_total: deletedTotal,
      deleted
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const limit = clampInteger(req.query.limit, { min: 1, max: 500, fallback: 50 });
  const offset = clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

  const sortKeyRaw = (req.query.sort_key ?? 'created_at').toString().trim().toLowerCase();
  const sortDirRaw = (req.query.sort_dir ?? 'desc').toString().trim().toLowerCase();
  const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
  const sortKeyAllow = new Set([
    'created_at',
    'chat_id',
    'username',
    'first_name',
    'bot_key',
    'effective_tier',
    'is_active',
    'last_seen_at',
    'streak_days',
    'xp_total',
    'level'
  ]);
  const sortKey = sortKeyAllow.has(sortKeyRaw) ? sortKeyRaw : 'created_at';

  const orderByMap = {
    created_at: `u.created_at`,
    chat_id: `u.chat_id`,
    username: `LOWER(u.username)`,
    first_name: `LOWER(u.first_name)`,
    bot_key: `ub.bot_key`,
    effective_tier: `effective_tier`,
    is_active: `is_active`,
    last_seen_at: `last_seen_at`,
    streak_days: `COALESCE(ms.streak_days, 0)`,
    xp_total: `COALESCE(xp.xp_total, 0)`,
    level: `FLOOR(COALESCE(xp.xp_total, 0) / 200.0)::int + 1`
  };
  const orderExpr = orderByMap[sortKey] || orderByMap.created_at;

  const params = [range.from.toISOString(), range.to.toISOString(), range.payload, limit, offset];
  const [totalRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       WHERE u.created_at >= $1::timestamptz
         AND u.created_at < $2::timestamptz
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3::text)`,
      params.slice(0, 3)
    ),
    pool.query(
      `WITH filtered_users AS (
         SELECT
           u.chat_id,
           u.username,
           u.first_name,
           u.created_at,
           u.updated_at,
           u.plan_tier,
           u.plan_expires_at,
           u.override_plan_tier,
           u.override_expires_at
         FROM users u
         WHERE u.created_at >= $1::timestamptz
           AND u.created_at < $2::timestamptz
           AND ($3::text IS NULL OR u.acquisition_start_payload = $3::text)
       ),
       activity_days AS (
         SELECT DISTINCT activity.chat_id, activity.day_utc
         FROM (
           SELECT
             v.chat_id,
             date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc
           FROM voice_usage_events v
           WHERE v.occurred_at >= $1::timestamptz
             AND v.occurred_at < $2::timestamptz

           UNION

           SELECT
             m.chat_id,
             date_trunc('day', m.created_at AT TIME ZONE 'UTC')::date AS day_utc
           FROM messages m
           WHERE m.role = 'user'
             AND m.created_at >= $1::timestamptz
             AND m.created_at < $2::timestamptz
         ) activity
         JOIN filtered_users u ON u.chat_id = activity.chat_id
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
       xp AS (
         SELECT
           up.chat_id,
           COALESCE(SUM(up.xp_total), 0)::int AS xp_total
         FROM user_progress up
         JOIN filtered_users u ON u.chat_id = up.chat_id
         GROUP BY up.chat_id
       ),
       user_activity AS (
         SELECT
           ub.chat_id,
           BOOL_OR(COALESCE(ub.is_active, true)) AS is_active
         FROM user_bots ub
         JOIN filtered_users u ON u.chat_id = ub.chat_id
         GROUP BY ub.chat_id
       )
       SELECT
         u.chat_id,
         u.username,
         u.first_name,
         ub.bot_key,
         u.created_at,
         COALESCE(ub.last_seen_at, u.updated_at) AS last_seen_at,
         COALESCE(ua.is_active, false) AS is_active,
         CASE
           WHEN u.override_plan_tier IS NOT NULL
             AND u.override_expires_at IS NOT NULL
             AND NOW() < u.override_expires_at
             THEN u.override_plan_tier
           WHEN u.plan_expires_at IS NOT NULL
             AND NOW() < u.plan_expires_at
             THEN u.plan_tier
           ELSE 'free'
         END AS effective_tier,
         COALESCE(ms.streak_days, 0) AS streak_days,
         COALESCE(xp.xp_total, 0) AS xp_total,
         FLOOR(COALESCE(xp.xp_total, 0) / 200.0)::int + 1 AS level
       FROM filtered_users u
       LEFT JOIN LATERAL (
         SELECT
           b.bot_key,
           b.last_seen_at
         FROM user_bots b
         WHERE b.chat_id = u.chat_id
         ORDER BY COALESCE(b.last_seen_at, b.updated_at, b.created_at) DESC, b.bot_key ASC
         LIMIT 1
       ) ub ON true
       LEFT JOIN max_streaks ms ON ms.chat_id = u.chat_id
       LEFT JOIN xp ON xp.chat_id = u.chat_id
       LEFT JOIN user_activity ua ON ua.chat_id = u.chat_id
       ORDER BY ${orderExpr} ${sortDir} NULLS LAST, u.chat_id DESC
       LIMIT $4::int
       OFFSET $5::int`,
      params
    )
  ]);

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    sort_key: sortKey,
    sort_dir: sortDirRaw === 'asc' ? 'asc' : 'desc',
    limit,
    offset,
    total: totalRes.rows[0]?.total || 0,
    items: rowsRes.rows || []
  });
});

app.post('/admin/broadcast-campaigns/preview', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  const filters = normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
  const botSelection = validateBroadcastBotSelection(filters.bots);
  if (!botSelection.ok) {
    return res.status(400).json({ error: botSelection.error });
  }
  filters.bots = botSelection.botKeys;
  const preview = await getBroadcastAudiencePreview(filters, range, 20);
  return res.json({
    filters: withBroadcastStreakRange(filters, range),
    count: preview.count,
    sample: preview.sample
  });
});

const broadcastMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BROADCAST_MEDIA_UPLOAD_MAX_BYTES }
});

app.post('/admin/broadcast-media', requireAdmin, broadcastMediaUpload.single('file'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!env.broadcastMediaChatId) {
    return res.status(400).json({ error: 'media_chat_id_not_configured' });
  }

  const messageKindRaw = (req.body?.messageKind ?? req.body?.message_kind ?? '').toString().trim().toLowerCase();
  const messageKind = messageKindRaw === 'photo' || messageKindRaw === 'video' ? messageKindRaw : null;
  if (!messageKind) {
    return res.status(400).json({ error: 'bad_message_kind' });
  }

  const file = req.file || null;
  if (!file?.buffer || !file?.size) {
    return res.status(400).json({ error: 'missing_file' });
  }

  const botSelection = validateBroadcastBotSelection(
    parseBotKeysField(req.body?.bots ?? req.body?.botKeys ?? req.body?.bot_keys)
  );
  if (!botSelection.ok) {
    return res.status(400).json({ error: botSelection.error });
  }
  const targetBots = botSelection.botKeys;

  const mediaFileIds = {};
  for (const botKey of targetBots) {
    try {
      const uploaded = await uploadTelegramMediaToChat({
        chatId: env.broadcastMediaChatId,
        messageKind,
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
        botKey
      });
      mediaFileIds[botKey] = uploaded.fileId;
    } catch (err) {
      const msg = sanitizeErrorText(err?.message || String(err)) || 'upload_failed';
      return res.status(502).json({ error: 'telegram_upload_failed', bot_key: botKey, detail: msg });
    }
  }

  return res.json({ ok: true, messageKind, mediaFileIds });
});

app.post('/admin/broadcast-campaigns', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  const filters = normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
  const botSelection = validateBroadcastBotSelection(filters.bots);
  if (!botSelection.ok) {
    return res.status(400).json({ error: botSelection.error });
  }
  filters.bots = botSelection.botKeys;
  const messageKindRaw = (req.body?.messageKind ?? req.body?.message_kind ?? 'text').toString().trim().toLowerCase();
  const messageKind = BROADCAST_MESSAGE_KINDS.has(messageKindRaw) ? messageKindRaw : null;
  if (!messageKind) {
    return res.status(400).json({ error: 'bad_message_kind' });
  }

  const mediaUrlRaw = (req.body?.mediaUrl ?? req.body?.media_url ?? '').toString().trim();
  if (mediaUrlRaw.length > BROADCAST_MEDIA_URL_MAX_LEN) {
    return res.status(400).json({ error: 'media_url_too_long', max_length: BROADCAST_MEDIA_URL_MAX_LEN });
  }
  const mediaUrl = mediaUrlRaw;
  const mediaFileIdRaw = (req.body?.mediaFileId ?? req.body?.media_file_id ?? '').toString().trim();
  if (mediaFileIdRaw.length > BROADCAST_MEDIA_FILE_ID_MAX_LEN) {
    return res.status(400).json({ error: 'media_file_id_too_long', max_length: BROADCAST_MEDIA_FILE_ID_MAX_LEN });
  }
  const mediaFileId = mediaFileIdRaw;
  const mediaFileIds = normalizeBroadcastMediaFileIds(req.body?.mediaFileIds ?? req.body?.media_file_ids);
  const replyMarkupRaw =
    req.body?.replyMarkup
    ?? req.body?.reply_markup
    ?? req.body?.inlineKeyboard
    ?? req.body?.inline_keyboard
    ?? null;
  const replyMarkupResult = normalizeBroadcastReplyMarkup(replyMarkupRaw);
  if (!replyMarkupResult.ok) {
    return res.status(400).json({ error: replyMarkupResult.error });
  }
  const replyMarkup = replyMarkupResult.replyMarkup;

  const messageRaw = (req.body?.messageText ?? req.body?.message ?? '').toString();
  const messageText = messageRaw.trim();

  if (messageKind === 'text') {
    if (!messageText) {
      return res.status(400).json({ error: 'empty_message' });
    }
    if (messageText.length > BROADCAST_MESSAGE_MAX_LEN) {
      return res.status(400).json({
        error: 'message_too_long',
        max_length: BROADCAST_MESSAGE_MAX_LEN
      });
    }
    if (mediaUrl || mediaFileId || mediaFileIds) {
      return res.status(400).json({ error: 'unexpected_media' });
    }
  } else {
    if (!mediaUrl && !mediaFileId && !mediaFileIds) {
      return res.status(400).json({ error: 'missing_media' });
    }
    if (messageText.length > BROADCAST_CAPTION_MAX_LEN) {
      return res.status(400).json({
        error: 'caption_too_long',
        max_length: BROADCAST_CAPTION_MAX_LEN
      });
    }
  }

  const recipients = await listBroadcastRecipients(filters, range, env.broadcastMaxRecipients + 1);
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'empty_audience' });
  }
  if (recipients.length > env.broadcastMaxRecipients) {
    return res.status(400).json({
      error: 'too_many_recipients',
      max_recipients: env.broadcastMaxRecipients,
      matched: recipients.length
    });
  }

  const chatIds = recipients.map((r) => Number(r.chat_id));
  const usernames = recipients.map((r) => r.username || null);
  const firstNames = recipients.map((r) => r.first_name || null);
  const fallbackBotKey = normalizeBotKey(env.defaultBotKey) || 'uk-de';
  const botKeys = recipients.map((r) => normalizeBotKey(r.bot_key) || fallbackBotKey);
  const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
  const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';
  const storedFilters = withBroadcastStreakRange(filters, range);

  let campaignId = null;
  await pool.query('BEGIN');
  try {
    const { rows: campaignRows } = await pool.query(
      `INSERT INTO broadcast_campaigns (
         status,
         filters,
         message_text,
         message_kind,
         media_url,
         media_file_id,
         media_file_ids,
         reply_markup,
         total_recipients,
         sent_count,
         failed_count,
         created_by
       )
       VALUES ('queued', $1::jsonb, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb, $8::int, 0, 0, $9::text)
       RETURNING id`,
      [
        JSON.stringify(storedFilters),
        messageText,
        messageKind,
        mediaUrl || null,
        mediaFileId || null,
        mediaFileIds ? JSON.stringify(mediaFileIds) : null,
        replyMarkup ? JSON.stringify(replyMarkup) : null,
        chatIds.length,
        createdBy
      ]
    );
    campaignId = campaignRows[0]?.id || null;
    if (!campaignId) throw new Error('campaign_create_failed');

    await pool.query(
      `INSERT INTO broadcast_recipients (
         campaign_id,
         chat_id,
         bot_key,
         username,
         first_name,
         status
       )
       SELECT
         $1::bigint,
         x.chat_id,
         x.bot_key,
         x.username,
         x.first_name,
         'pending'
       FROM UNNEST($2::bigint[], $3::text[], $4::text[], $5::text[]) AS x(chat_id, bot_key, username, first_name)`,
      [campaignId, chatIds, botKeys, usernames, firstNames]
    );

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  const apiBoss = await getApiBoss();
  await enqueueBroadcastCampaignJob(apiBoss, campaignId);

  return res.json({
    campaign: {
      id: campaignId,
      status: 'queued',
      total_recipients: chatIds.length,
      sent_count: 0,
      failed_count: 0,
      pending_count: chatIds.length
    }
  });
});

app.get('/admin/broadcast-campaigns/:id', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const campaignId = Number(req.params.id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: 'bad_campaign_id' });
  }

  const { rows: campaignRows } = await pool.query(
    `SELECT
       c.id,
       c.status,
       c.message_text,
       c.message_kind,
       c.media_url,
       c.media_file_id,
       c.media_file_ids,
       c.reply_markup,
       c.filters,
       c.total_recipients,
       c.sent_count,
       c.failed_count,
       c.created_by,
       c.created_at,
       c.updated_at,
       c.started_at,
       c.finished_at,
       c.error_text,
       COALESCE(s.pending_count, 0)::int AS pending_count
     FROM broadcast_campaigns c
     LEFT JOIN (
       SELECT
         campaign_id,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
       FROM broadcast_recipients
       WHERE campaign_id = $1
       GROUP BY campaign_id
     ) s ON s.campaign_id = c.id
     WHERE c.id = $1
     LIMIT 1`,
    [campaignId]
  );

  const campaign = campaignRows[0];
  if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });

  const { rows: failedRows } = await pool.query(
    `SELECT
       chat_id,
       bot_key,
       username,
       first_name,
       attempts,
       last_error,
       updated_at
     FROM broadcast_recipients
     WHERE campaign_id = $1
       AND status = 'failed'
     ORDER BY updated_at DESC
     LIMIT 20`,
    [campaignId]
  );

  return res.json({
    campaign,
    failed: failedRows
  });
});

app.post('/auth/telegram', async (req, res) => {
  const { initData } = req.body || {};
  const result = verifyInitData(initData);
  if (!result.ok) {
    console.warn('auth/telegram failed', {
      reason: result.reason,
      hasInitData: Boolean(initData),
      initDataLength: typeof initData === 'string' ? initData.length : 0,
      origin: req.headers.origin,
      ua: req.headers['user-agent']
    });
    return res.status(401).json({ error: result.reason });
  }

  const user = result.user;
  if (!user?.id) {
    console.warn('auth/telegram missing user', {
      origin: req.headers.origin,
      ua: req.headers['user-agent']
    });
    return res.status(400).json({ error: 'missing_user' });
  }

  await upsertUser(user, { botKey: result.botKey || null });
  await recordActionEventSafe({
    chatId: user.id,
    botKey: result.botKey || null,
    actionType: 'start',
    source: 'auth_telegram',
    idempotencyKey: `start:${user.id}`,
    occurredAt: Number.isFinite(result.authDate) ? new Date(result.authDate * 1000) : null
  });

  const authBotKey = normalizeBotKey(result.botKey || null);
  const token = signSession({ chatId: user.id, username: user.username || null, botKey: authBotKey || undefined });
  console.info('auth/telegram ok', {
    chatId: user.id,
    username: user.username || null
  });
  return res.json({
    token,
    bot_key: authBotKey,
    user: { id: user.id, username: user.username || null, first_name: user.first_name || null }
  });
});

app.get('/plans', requireAuth, async (req, res) => {
  const currency = (req.query.currency || 'EUR').toString().toUpperCase();
  const includeAllIntervals = parseQueryBoolean(
    req.query.include_all_intervals ?? req.query.includeAllIntervals
  );
  const chatId = req.auth.chatId;
  const plans = await loadPlanCatalog(currency, includeAllIntervals, { includeStripePriceId: true });

  try {
    const { rows: userRows } = await pool.query(
      `SELECT plan_tier, plan_expires_at, plan_autorenew, pending_plan_tier, pending_plan_effective_at,
              override_plan_tier, override_expires_at, billing_currency, stripe_subscription_status
         FROM users
        WHERE chat_id = $1
        LIMIT 1`,
      [chatId]
    );

    const user = userRows[0] || null;
    const usage = user ? await getUserUsageSummary(chatId) : null;
    const effectiveTier = (usage?.tier || user?.plan_tier || 'free').toString().trim().toLowerCase();
    if (user && effectiveTier !== 'pro') {
      await recordActionEventSafe({
        chatId,
        botKey: req.auth?.botKey || null,
        actionType: 'paywall_shown',
        source: 'api',
        idempotencyKey: `paywall_shown:${chatId}`,
        properties: {
          tier: effectiveTier,
          currency,
          embedded_checkout: null,
          screen: 'plans'
        }
      });
    }

    return res.json({
      currency,
      user,
      plans,
      usage
    });
  } catch (err) {
    console.warn('plans personalized payload failed; returning catalog only', {
      chatId,
      botKey: req.auth?.botKey || null,
      err: err?.message || String(err)
    });
  }

  return res.json({
    currency,
    user: null,
    plans,
    usage: null
  });
});

app.get('/public/plans', async (req, res) => {
  const currency = (req.query.currency || 'EUR').toString().toUpperCase();
  const includeAllIntervals = parseQueryBoolean(
    req.query.include_all_intervals ?? req.query.includeAllIntervals
  );
  const plans = await loadPlanCatalog(currency, includeAllIntervals);

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json({
    currency,
    plans
  });
});

app.get('/me', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
  const user = await getMeUserRow(chatId, requestedBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user });
});

app.get('/me/dashboard', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
  const user = await getMeUserRow(chatId, requestedBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const [usage, streak, feedbackSummary] = await Promise.all([
    getUserUsageSummary(chatId),
    getUserStreakSummary(chatId),
    getUserFeedbackSummary(chatId, user.bot_key)
  ]);

  return res.json({
    user: {
      chat_id: user.chat_id,
      username: user.username || null,
      first_name: user.first_name || null,
      plan_tier: user.plan_tier || 'free'
    },
    selected_bot: {
      bot_key: user.bot_key,
      bot_name: user.bot_name || null,
      learning_language: user.learning_language || null,
      base_language: user.base_language || null,
      level: user.level || 'a1',
      telegram_url: user.telegram_url || null,
      reply_mode: user.reply_mode || 'text',
      tts_voice: user.tts_voice || 'marin',
      teacher_avatar_emoji: user.teacher_avatar_emoji || null,
      teacher_tagline_uk: user.teacher_tagline_uk || null,
      teacher_tagline_en: user.teacher_tagline_en || null,
      teacher_tagline_it: user.teacher_tagline_it || null,
      teacher_style_tags: user.teacher_style_tags || null
    },
    streak,
    usage,
    feedback_summary: feedbackSummary
  });
});

app.get('/me/bots', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);

  const [userBots, user] = await Promise.all([
    listUserBots(chatId),
    getMeUserRow(chatId, requestedBotKey)
  ]);

  return res.json({
    selected_bot_key: user?.bot_key || requestedBotKey || null,
    bots: userBots,
    available_bots: listAvailableBotsForUser(userBots)
  });
});

app.get('/me/feedback-thread', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await resolveUserBotKey(chatId);
  const botKey = requestedBotKey || normalizeBotKey(env.defaultBotKey) || 'uk-de';
  const thread = await getUserFeedbackThread(chatId, botKey);
  return res.json(thread);
});

app.post('/me/feedbacks', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await resolveUserBotKey(chatId);
  const botKey = requestedBotKey || normalizeBotKey(env.defaultBotKey) || 'uk-de';
  const category = normalizeFeedbackCategory(req.body?.category);
  const message = (req.body?.message ?? '').toString().trim();

  if (!category) {
    return res.status(400).json({ error: 'bad_feedback_category' });
  }
  if (!message) {
    return res.status(400).json({ error: 'feedback_message_required' });
  }
  if (message.length > MINIAPP_FEEDBACK_MESSAGE_MAX_LEN) {
    return res.status(400).json({ error: 'feedback_message_too_long' });
  }

  const user = await getMeUserRow(chatId, botKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const { rows } = await pool.query(
    `INSERT INTO feedback (
       chat_id,
       username,
       first_name,
       kind,
       feedback_text,
       bot_key,
       category,
       source
     )
     VALUES ($1, $2, $3, 'text', $4, $5, $6, 'miniapp')
     RETURNING id, created_at, feedback_text, category`,
    [
      chatId,
      user.username || null,
      user.first_name || null,
      message,
      botKey,
      category
    ]
  );

  await pool.query(
    `INSERT INTO feedback_threads (
       chat_id,
       bot_key,
       archived_at,
       archived_by,
       user_last_read_at
     )
     VALUES ($1, $2, NULL, NULL, NOW())
     ON CONFLICT (chat_id, bot_key) DO UPDATE
       SET archived_at = NULL,
           archived_by = NULL,
           user_last_read_at = NOW()`,
    [chatId, botKey]
  );

  const feedbackSummary = await getUserFeedbackSummary(chatId, botKey);
  const row = rows[0] || null;

  return res.status(201).json({
    bot_key: botKey,
    item: row ? {
      id: Number(row.id || 0),
      kind: 'feedback',
      sender: 'user',
      category: row.category || category,
      text: row.feedback_text || message,
      created_at: row.created_at
    } : null,
    feedback_summary: feedbackSummary
  });
});

app.post('/me/feedback-thread/read', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await resolveUserBotKey(chatId);
  const botKey = requestedBotKey || normalizeBotKey(env.defaultBotKey) || 'uk-de';

  await pool.query(
    `INSERT INTO feedback_threads (
       chat_id,
       bot_key,
       archived_at,
       archived_by,
       user_last_read_at
     )
     VALUES ($1, $2, NULL, NULL, NOW())
     ON CONFLICT (chat_id, bot_key) DO UPDATE
       SET user_last_read_at = NOW()`,
    [chatId, botKey]
  );

  const feedbackSummary = await getUserFeedbackSummary(chatId, botKey);
  return res.json({
    bot_key: botKey,
    user_last_read_at: feedbackSummary.user_last_read_at,
    unread_admin_replies: feedbackSummary.unread_admin_replies
  });
});

app.post('/me/target-lang', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const raw = (req.body?.target_lang ?? req.body?.targetLang ?? '').toString().trim().toLowerCase();
  if (!['en', 'de'].includes(raw)) {
    return res.status(400).json({ error: 'bad_target_lang' });
  }

  const targetBotKey = botKeyFromTargetLang(raw) || normalizeBotKey(env.defaultBotKey) || 'uk-de';

  const { rowCount } = await pool.query(
     `INSERT INTO user_bots (
       chat_id,
       bot_key,
       level,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     SELECT $1, $2, 'a1', 'voice', 'marin', NOW(), NOW(), true, NOW()
     FROM users u
     WHERE u.chat_id = $1
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       last_seen_at = NOW(),
       is_active = true,
       updated_at = NOW()`,
    [chatId, targetBotKey]
  );

  if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
  const user = await getMeUserRow(chatId, targetBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user });
});

app.post('/me/level', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const raw = (req.body?.level ?? '').toString().trim().toLowerCase();
  if (!['a1', 'a2', 'b1', 'b2', 'c1'].includes(raw)) {
    return res.status(400).json({ error: 'bad_level' });
  }

  const currentBotKey =
    requestedBotKeyFromReq(req) ||
    normalizeBotKey(req.auth?.botKey || null) ||
    await resolveUserBotKey(chatId) ||
    normalizeBotKey(env.defaultBotKey) ||
    'uk-de';

  const { rowCount } = await pool.query(
    `INSERT INTO user_bots (
       chat_id,
       bot_key,
       level,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     SELECT $1, $2, $3, 'text', 'marin', NOW(), NOW(), true, NOW()
     FROM users u
     WHERE u.chat_id = $1
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       level = EXCLUDED.level,
       last_seen_at = NOW(),
       is_active = true,
       updated_at = NOW()`,
    [chatId, currentBotKey, raw]
  );

  if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
  const user = await getMeUserRow(chatId, currentBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  await recordActionEventSafe({
    chatId,
    botKey: currentBotKey,
    actionType: 'profile_set_level',
    source: 'api',
    idempotencyKey: `profile_set_level:${chatId}`,
    properties: { level: raw, via: 'miniapp' }
  });

  return res.json({ user });
});

app.post('/billing/checkout', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { tier, currency, billing_interval: billingIntervalRaw } = req.body || {};
  const normalizedTier = String(tier || '').toLowerCase();
  if (!PURCHASE_ALLOWED_TIERS.has(normalizedTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }
  const normalizedBillingInterval = normalizeBillingInterval(billingIntervalRaw, 'month');
  if (!normalizedBillingInterval) {
    return res.status(400).json({ error: 'bad_billing_interval' });
  }

  const billingCurrency = (currency || 'EUR').toString().toUpperCase();

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
      LIMIT 1`,
    [normalizedTier, billingCurrency, normalizedBillingInterval]
  );

  if (!priceRows[0]?.stripe_price_id) {
    return res.status(400).json({ error: 'price_not_found' });
  }

  const { rows: userRows } = await pool.query(
    `SELECT stripe_customer_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  let stripeCustomerId = userRows[0]?.stripe_customer_id || null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      metadata: { telegram_chat_id: String(chatId) }
    });

    stripeCustomerId = customer.id;

    await pool.query(
      `UPDATE users
          SET stripe_customer_id = $1,
              updated_at = NOW()
        WHERE chat_id = $2`,
      [stripeCustomerId, chatId]
    );
  }

  const sessionParams = {
    mode: 'subscription',
    customer: stripeCustomerId,
    client_reference_id: String(chatId),
    line_items: [{ price: priceRows[0].stripe_price_id, quantity: 1 }],
    success_url: env.webappReturnUrlIsCustom
      ? env.webappReturnUrl
      : `${env.webappUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.webappReturnUrlIsCustom ? env.webappReturnUrl : `${env.webappUrl}/cancel`,
    allow_promotion_codes: true,
    metadata: {
      chat_id: String(chatId),
      tier: normalizedTier,
      billing_interval: normalizedBillingInterval
    }
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    if (err?.type === 'StripeInvalidRequestError' && err?.code === 'resource_missing' && err?.param === 'customer') {
      const customer = await stripe.customers.create({
        metadata: { telegram_chat_id: String(chatId) }
      });

      stripeCustomerId = customer.id;

      await pool.query(
        `UPDATE users
            SET stripe_customer_id = $1,
                updated_at = NOW()
          WHERE chat_id = $2`,
        [stripeCustomerId, chatId]
      );

      session = await stripe.checkout.sessions.create({
        ...sessionParams,
        customer: stripeCustomerId
      });
    } else {
      console.error('Stripe checkout failed', err);
      return res.status(500).json({ error: 'stripe_error' });
    }
  }

  return res.json({ url: session.url });
});

app.post('/billing/checkout/embedded', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { tier, currency, billing_interval: billingIntervalRaw } = req.body || {};
  const normalizedTier = String(tier || '').toLowerCase();
  if (!PURCHASE_ALLOWED_TIERS.has(normalizedTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }
  const normalizedBillingInterval = normalizeBillingInterval(billingIntervalRaw, 'month');
  if (!normalizedBillingInterval) {
    return res.status(400).json({ error: 'bad_billing_interval' });
  }

  const billingCurrency = (currency || 'EUR').toString().toUpperCase();

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
      LIMIT 1`,
    [normalizedTier, billingCurrency, normalizedBillingInterval]
  );

  if (!priceRows[0]?.stripe_price_id) {
    return res.status(400).json({ error: 'price_not_found' });
  }

  const { rows: userRows } = await pool.query(
    `SELECT stripe_customer_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  let stripeCustomerId = userRows[0]?.stripe_customer_id || null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      metadata: { telegram_chat_id: String(chatId) }
    });

    stripeCustomerId = customer.id;

    await pool.query(
      `UPDATE users
          SET stripe_customer_id = $1,
              updated_at = NOW()
        WHERE chat_id = $2`,
      [stripeCustomerId, chatId]
    );
  }

  const sessionParams = {
    ui_mode: 'embedded',
    mode: 'subscription',
    customer: stripeCustomerId,
    client_reference_id: String(chatId),
    line_items: [{ price: priceRows[0].stripe_price_id, quantity: 1 }],
    return_url: `${env.webappUrl}/success`,
    allow_promotion_codes: true,
    redirect_on_completion: 'always',
    metadata: {
      chat_id: String(chatId),
      tier: normalizedTier,
      billing_interval: normalizedBillingInterval
    }
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    if (err?.type === 'StripeInvalidRequestError' && err?.code === 'resource_missing' && err?.param === 'customer') {
      const customer = await stripe.customers.create({
        metadata: { telegram_chat_id: String(chatId) }
      });

      stripeCustomerId = customer.id;

      await pool.query(
        `UPDATE users
            SET stripe_customer_id = $1,
                updated_at = NOW()
          WHERE chat_id = $2`,
        [stripeCustomerId, chatId]
      );

      session = await stripe.checkout.sessions.create({
        ...sessionParams,
        customer: stripeCustomerId
      });
    } else {
      console.error('Stripe embedded checkout failed', err);
      return res.status(500).json({ error: 'stripe_error' });
    }
  }

  if (!session?.client_secret) {
    console.error('Stripe embedded checkout: missing client_secret', { id: session?.id });
    return res.status(500).json({ error: 'stripe_error' });
  }

  return res.json({ client_secret: session.client_secret, id: session.id });
});

app.post('/billing/cancel', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { rows } = await pool.query(
    `SELECT stripe_subscription_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) {
    return res.status(400).json({ error: 'no_subscription' });
  }

  const updated = await stripe.subscriptions.update(subId, {
    cancel_at_period_end: true
  });

  await pool.query(
    `UPDATE users
        SET plan_autorenew = false,
            stripe_subscription_status = $1,
            updated_at = NOW()
      WHERE chat_id = $2`,
    [updated.status, chatId]
  );

  return res.json({ ok: true, status: updated.status });
});

app.post('/billing/resume', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { rows } = await pool.query(
    `SELECT stripe_subscription_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) {
    return res.status(400).json({ error: 'no_subscription' });
  }

  const updated = await stripe.subscriptions.update(subId, {
    cancel_at_period_end: false
  });

  await pool.query(
    `UPDATE users
        SET plan_autorenew = true,
            stripe_subscription_status = $1,
            updated_at = NOW()
      WHERE chat_id = $2`,
    [updated.status, chatId]
  );

  return res.json({ ok: true, status: updated.status });
});

app.post('/billing/portal', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { rows } = await pool.query(
    `SELECT stripe_customer_id, stripe_subscription_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  let customerId = rows[0]?.stripe_customer_id || null;
  const subscriptionId = rows[0]?.stripe_subscription_id || null;

  if (!customerId && subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (typeof sub?.customer === 'string') {
        customerId = sub.customer;
        await pool.query(
          `UPDATE users
              SET stripe_customer_id = $1,
                  updated_at = NOW()
            WHERE chat_id = $2`,
          [customerId, chatId]
        );
      }
    } catch (err) {
      console.error('Stripe: failed to retrieve subscription for portal', err);
      return res.status(500).json({ error: 'stripe_error' });
    }
  }

  if (!customerId) {
    return res.status(400).json({ error: 'no_customer' });
  }

  let session;
  try {
    const params = {
      customer: customerId,
      return_url: env.webappReturnUrl
    };
    if (env.stripePortalConfigId) {
      params.configuration = env.stripePortalConfigId;
    }
    session = await stripe.billingPortal.sessions.create(params);
  } catch (err) {
    console.error('Stripe: billing portal session create failed', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  return res.json({ url: session.url });
});

app.post('/billing/upgrade/preview', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { tier } = req.body || {};
  const targetTier = String(tier || '').toLowerCase();
  if (!PURCHASE_ALLOWED_TIERS.has(targetTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }

  const { rows: userRows } = await pool.query(
    `SELECT stripe_subscription_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const subscriptionId = userRows[0]?.stripe_subscription_id || null;
  if (!subscriptionId) {
    return res.status(400).json({ error: 'no_subscription' });
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price']
    });
  } catch (err) {
    console.error('Stripe: failed to retrieve subscription for upgrade preview', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  const subscriptionItem = subscription.items?.data?.[0] || null;
  const currentPriceId = subscriptionItem?.price?.id || null;
  const currency = subscriptionItem?.price?.currency?.toUpperCase() || null;
  const billingInterval = subscriptionItem?.price?.recurring?.interval || 'month';
  const quantity = subscriptionItem?.quantity || 1;
  if (!subscriptionItem?.id || !currentPriceId || !currency) {
    return res.status(400).json({ error: 'subscription_not_upgradeable' });
  }

  const currentTier = await resolveTierByPrice(currentPriceId);
  const tierRank = { free: 0, plus: 1, pro: 2 };
  if (currentTier && (tierRank[targetTier] ?? 0) <= (tierRank[currentTier] ?? 0)) {
    return res.status(400).json({ error: 'not_an_upgrade', current_tier: currentTier });
  }

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id, amount_cents
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
      LIMIT 1`,
    [targetTier, currency, billingInterval]
  );

  const targetPriceId = priceRows[0]?.stripe_price_id || null;
  const targetAmountCents = priceRows[0]?.amount_cents ?? null;
  if (!targetPriceId) {
    return res.status(400).json({ error: 'price_not_found' });
  }

  const prorationDate = Math.floor(Date.now() / 1000);
  let upcoming;
  try {
    upcoming = await stripe.invoices.retrieveUpcoming({
      subscription: subscriptionId,
      subscription_items: [{ id: subscriptionItem.id, price: targetPriceId, quantity }],
      subscription_proration_behavior: 'always_invoice',
      subscription_proration_date: prorationDate
    });
  } catch (err) {
    console.error('Stripe: failed to preview upgrade invoice', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  return res.json({
    ok: true,
    current_tier: currentTier,
    target_tier: targetTier,
    currency,
    billing_interval: billingInterval,
    amount_due_cents: upcoming.amount_due || 0,
    next_amount_cents: Number.isFinite(targetAmountCents) ? targetAmountCents : null,
    proration_date: prorationDate
  });
});

app.post('/billing/upgrade', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { tier, proration_date: prorationDateRaw } = req.body || {};
  const targetTier = String(tier || '').toLowerCase();
  if (!PURCHASE_ALLOWED_TIERS.has(targetTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }
  const parsedProrationDate = Number(prorationDateRaw);
  const prorationDate = Number.isFinite(parsedProrationDate) && parsedProrationDate > 0
    ? Math.floor(parsedProrationDate)
    : null;

  const { rows: userRows } = await pool.query(
    `SELECT stripe_subscription_id
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const subscriptionId = userRows[0]?.stripe_subscription_id || null;
  if (!subscriptionId) {
    return res.status(400).json({ error: 'no_subscription' });
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price', 'latest_invoice.payment_intent', 'latest_invoice']
    });
  } catch (err) {
    console.error('Stripe: failed to retrieve subscription for upgrade', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  const subscriptionItem = subscription.items?.data?.[0] || null;
  const currentPriceId = subscriptionItem?.price?.id || null;
  const currency = subscriptionItem?.price?.currency?.toUpperCase() || null;
  const billingInterval = subscriptionItem?.price?.recurring?.interval || 'month';
  if (!subscriptionItem?.id || !currentPriceId || !currency) {
    return res.status(400).json({ error: 'subscription_not_upgradeable' });
  }

  const currentTier = await resolveTierByPrice(currentPriceId);
  const tierRank = { free: 0, plus: 1, pro: 2 };
  if (currentTier && (tierRank[targetTier] ?? 0) <= (tierRank[currentTier] ?? 0)) {
    return res.status(400).json({ error: 'not_an_upgrade', current_tier: currentTier });
  }

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
      LIMIT 1`,
    [targetTier, currency, billingInterval]
  );

  const targetPriceId = priceRows[0]?.stripe_price_id || null;
  if (!targetPriceId) {
    return res.status(400).json({ error: 'price_not_found' });
  }

  let updated;
  try {
    const updateParams = {
      items: [{ id: subscriptionItem.id, price: targetPriceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice.payment_intent', 'latest_invoice']
    };
    if (prorationDate) {
      updateParams.proration_date = prorationDate;
    }
    updated = await stripe.subscriptions.update(subscriptionId, updateParams);
  } catch (err) {
    console.error('Stripe: upgrade failed', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null;
  const paymentIntent = typeof invoice?.payment_intent === 'object' ? invoice.payment_intent : null;

  const pendingUpgrade = Boolean(updated.pending_update);

  if (pendingUpgrade) {
    await pool.query(
      `UPDATE users
          SET pending_plan_tier = $1,
              pending_plan_effective_at = NOW(),
              updated_at = NOW()
        WHERE chat_id = $2`,
      [targetTier, chatId]
    );
  } else {
    await pool.query(
      `UPDATE users
          SET pending_plan_tier = NULL,
              pending_plan_effective_at = NULL,
              updated_at = NOW()
        WHERE chat_id = $1`,
      [chatId]
    );
  }

  return res.json({
    ok: true,
    pending: pendingUpgrade,
    currency,
    billing_interval: billingInterval,
    current_tier: currentTier,
    target_tier: targetTier,
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status || null,
          hosted_invoice_url: invoice.hosted_invoice_url || null
        }
      : null,
    payment_intent: paymentIntent
      ? {
          id: paymentIntent.id,
          status: paymentIntent.status || null,
          client_secret: paymentIntent.client_secret || null
        }
      : null
  });
});

app.post('/billing/downgrade', requireAuth, async (req, res) => {
  return res.status(400).json({ error: 'plan_change_unavailable' });
});

async function upsertUser(user, { botKey = null } = {}) {
  const chatId = user.id;
  const username = user.username || null;
  const firstName = user.first_name || null;
  const normalizedBotKey = normalizeBotKey(botKey);
  const botKeyForContext = normalizedBotKey || normalizeBotKey(env.defaultBotKey);

  await pool.query(
    `INSERT INTO users (chat_id, username, first_name, inactive_reason, inactive_at, last_delivery_error)
     VALUES ($1, $2, $3, NULL, NULL, NULL)
     ON CONFLICT (chat_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       inactive_reason = NULL,
       inactive_at = NULL,
       last_delivery_error = NULL,
       updated_at = NOW()`,
    [chatId, username, firstName]
  );

  if (!botKeyForContext) return;

  await pool.query(
    `INSERT INTO user_bots (
       chat_id,
       bot_key,
       level,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     VALUES ($1, $2, 'a1', 'text', 'marin', NOW(), NOW(), true, NOW())
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       last_seen_at = NOW(),
       is_active = true,
       updated_at = NOW()`,
    [chatId, botKeyForContext]
  );
}

async function resolveTierByPrice(priceId) {
  const { rows } = await pool.query(
    `SELECT tier
       FROM plan_prices
      WHERE stripe_price_id = $1
      LIMIT 1`,
    [priceId]
  );
  return rows[0]?.tier || null;
}

async function notifyPlanChanged(payload) {
  if (!env.planChangedWebhookUrl) return;
  try {
    const botKey = await resolveUserBotKey(payload?.chat_id);
    const url = webhookUrlForBot(env.planChangedWebhookUrl, 'plan-changed', botKey);
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      let body = await resp.text().catch(() => '');

      // Backward-compatible fallback:
      // when PLAN_CHANGED_WEBHOOK_URL has no {bot_key} and WEBHOOKS_APPEND_BOT_KEY=false,
      // retry once with "-<bot_key>" suffix for rendered multi-bot workflows.
      if (resp.status === 404 && botKey) {
        const fallbackUrl = webhookUrlForBot(env.planChangedWebhookUrl, 'plan-changed', botKey, {
          forceAppendBotKey: true
        });
        if (fallbackUrl && fallbackUrl !== url) {
          const fallbackResp = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (fallbackResp.ok) return;
          resp = fallbackResp;
          body = await fallbackResp.text().catch(() => '');
          console.warn('Plan change webhook fallback failed', {
            status: fallbackResp.status,
            url: fallbackUrl,
            body
          });
          return;
        }
      }

      console.warn('Plan change webhook failed', { status: resp.status, url, body });
    }
  } catch (err) {
    console.error('Plan change webhook failed', err);
  }
}

async function resolveChatIdForPayment(obj) {
  const metaChatId = obj?.metadata?.chat_id || obj?.metadata?.chatId;
  if (metaChatId) {
    const parsed = Number(metaChatId);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (obj?.client_reference_id) {
    const parsed = Number(obj.client_reference_id);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (obj?.customer) {
    const { rows } = await pool.query(
      `SELECT chat_id
         FROM users
        WHERE stripe_customer_id = $1
        LIMIT 1`,
      [obj.customer]
    );
    if (rows[0]?.chat_id) return rows[0].chat_id;
  }

  if (obj?.subscription) {
    const { rows } = await pool.query(
      `SELECT chat_id
         FROM users
        WHERE stripe_subscription_id = $1
        LIMIT 1`,
      [obj.subscription]
    );
    if (rows[0]?.chat_id) return rows[0].chat_id;
  }

  return null;
}

async function handleStripeEvent(event) {
  const type = event.type;
  const obj = event.data.object;

  const paymentChatId = await resolveChatIdForPayment(obj);
  if (!paymentChatId) {
    console.warn('Stripe event missing chat_id; skipping payment insert', {
      eventId: event.id,
      type,
      customer: obj?.customer || null,
      subscription: obj?.subscription || null
    });
  } else {
    await pool.query(
      `INSERT INTO payments (
          chat_id,
          tier,
          provider,
          amount_cents,
          currency,
          status,
          stripe_event_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_invoice_id,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          stripe_price_id,
          raw
       ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       ) ON CONFLICT (stripe_event_id) WHERE stripe_event_id IS NOT NULL DO NOTHING`,
      [
        paymentChatId,
        obj?.metadata?.tier || null,
        'stripe',
        obj?.amount_total || obj?.amount_paid || null,
        obj?.currency || null,
        obj?.status || null,
        event.id,
        obj?.customer || null,
        obj?.subscription || obj?.id || null,
        obj?.invoice || obj?.id || null,
        obj?.id || null,
        obj?.payment_intent || null,
        obj?.price || obj?.items?.data?.[0]?.price?.id || null,
        event
      ]
    );
  }

  if (type === 'checkout.session.completed') {
    const session = obj;
    if (!session.customer || !session.subscription) return;

    const sessionChatId = Number(session.client_reference_id);
    if (Number.isFinite(sessionChatId)) {
      await pool.query(
        `UPDATE users
            SET stripe_customer_id = $1,
                stripe_subscription_id = $2,
                stripe_subscription_status = $3,
                updated_at = NOW()
          WHERE chat_id = $4`,
        [session.customer, session.subscription, session.status, sessionChatId]
      );
    } else {
      console.warn('Stripe checkout.session.completed missing numeric client_reference_id', {
        eventId: event.id,
        client_reference_id: session.client_reference_id ?? null
      });
    }

    const trackedChatId = Number.isFinite(sessionChatId)
      ? sessionChatId
      : (Number.isFinite(Number(paymentChatId)) ? Number(paymentChatId) : null);

    if (trackedChatId) {
      const trackedBotKey = await resolveUserBotKey(trackedChatId);
      const occurredAt = typeof event?.created === 'number' ? new Date(event.created * 1000) : null;
      await recordActionEventSafe({
        chatId: trackedChatId,
        botKey: trackedBotKey,
        actionType: 'purchase_success',
        source: 'stripe_webhook',
        idempotencyKey: `purchase_success:${event.id}`,
        occurredAt,
        properties: {
          stripe_event_id: event.id,
          stripe_checkout_session_id: session.id || null,
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
          amount_total: session.amount_total ?? null,
          currency: session.currency || null,
          tier: session.metadata?.tier || null,
          billing_interval: session.metadata?.billing_interval || null
        }
      });
    }
  }

  if (type.startsWith('customer.subscription.')) {
    const subscription = obj;
    const customerId = subscription.customer;
    const priceId = subscription.items?.data?.[0]?.price?.id || null;
    const tier = priceId ? await resolveTierByPrice(priceId) : null;
    const hasPendingUpdate = Boolean(subscription.pending_update);
    const pendingItem = subscription.pending_update?.subscription_items?.[0] || null;
    const pendingPriceId =
      typeof pendingItem?.price === 'string'
        ? pendingItem.price
        : typeof pendingItem?.price === 'object'
          ? pendingItem.price?.id || null
          : null;
    const pendingTier = pendingPriceId ? await resolveTierByPrice(pendingPriceId) : null;
    const scheduleId =
      typeof subscription.schedule === 'string'
        ? subscription.schedule
        : typeof subscription.schedule === 'object'
          ? subscription.schedule?.id || null
          : null;
    const status = subscription.status;
    const isActive = ['active', 'trialing', 'past_due', 'unpaid'].includes(status);
    const computedTier = isActive && tier ? tier : 'free';

    const nowMs = Date.now();
    const maybeEndSeconds =
      typeof subscription.current_period_end === 'number' ? subscription.current_period_end : null;
    const maybeEndMs = maybeEndSeconds ? maybeEndSeconds * 1000 : null;

    let periodEndSeconds = maybeEndSeconds;
    let periodStartSeconds =
      typeof subscription.current_period_start === 'number' ? subscription.current_period_start : null;

    const looksSuspicious =
      isActive && (typeof maybeEndMs !== 'number' || !Number.isFinite(maybeEndMs) || maybeEndMs < nowMs + 60 * 60 * 1000);

    if (looksSuspicious && subscription?.id) {
      console.warn('Stripe: subscription period end missing/suspicious; retrieving fresh subscription', {
        eventId: event.id,
        type,
        status,
        customerId,
        subscriptionId: subscription.id,
        current_period_end: subscription.current_period_end ?? null
      });
      try {
        const fresh = await stripe.subscriptions.retrieve(subscription.id);
        if (typeof fresh.current_period_end === 'number') {
          periodEndSeconds = fresh.current_period_end;
        }
        if (typeof fresh.current_period_start === 'number') {
          periodStartSeconds = fresh.current_period_start;
        }
      } catch (err) {
        console.warn('Stripe: failed to retrieve subscription for period dates', {
          eventId: event.id,
          type,
          subscriptionId: subscription.id,
          customerId,
          err: err?.message || String(err)
        });
      }
    }

    const periodEnd =
      typeof periodEndSeconds === 'number' && Number.isFinite(periodEndSeconds)
        ? new Date(periodEndSeconds * 1000)
        : null;
    const periodStart =
      typeof periodStartSeconds === 'number' && Number.isFinite(periodStartSeconds)
        ? new Date(periodStartSeconds * 1000)
        : null;

    const autoRenew = !subscription.cancel_at_period_end;
    const currency = subscription.items?.data?.[0]?.price?.currency?.toUpperCase() || 'EUR';

    const { rows: prevRows } = await pool.query(
      `SELECT chat_id, plan_tier, stripe_price_id
         FROM users
        WHERE stripe_customer_id = $1
        LIMIT 1`,
      [customerId]
    );
    const prevTier = prevRows[0]?.plan_tier || 'free';
    const prevStripePriceId = prevRows[0]?.stripe_price_id || null;
    const prevChatId = prevRows[0]?.chat_id || null;

    let schedulePendingTier = null;
    let schedulePendingEffectiveAt = null;
    if (scheduleId) {
      try {
        const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId, {
          expand: ['phases.items.price']
        });
        const nowSec = Math.floor(Date.now() / 1000);
        const phases = Array.isArray(schedule?.phases) ? schedule.phases : [];
        let currentIndex = -1;
        for (let i = 0; i < phases.length; i += 1) {
          const phase = phases[i];
          const start = typeof phase?.start_date === 'number' ? phase.start_date : null;
          const end = typeof phase?.end_date === 'number' ? phase.end_date : null;
          if (start === null) continue;
          const isCurrent = start <= nowSec && (end === null || nowSec < end);
          if (isCurrent) {
            currentIndex = i;
            break;
          }
        }

        const next = currentIndex >= 0 ? phases[currentIndex + 1] : null;
        const nextItem = next?.items?.[0] || null;
        const nextPriceId =
          typeof nextItem?.price === 'string'
            ? nextItem.price
            : typeof nextItem?.price === 'object'
              ? nextItem.price?.id || null
              : null;

        if (nextPriceId && nextPriceId !== priceId) {
          const maybeTier = await resolveTierByPrice(nextPriceId);
          if (maybeTier) {
            schedulePendingTier = maybeTier;
            const start = typeof next?.start_date === 'number' ? next.start_date : null;
            schedulePendingEffectiveAt = start ? new Date(start * 1000) : null;
          }
        }
      } catch (err) {
        console.warn('Stripe: failed to retrieve subscription schedule for pending tier', {
          eventId: event.id,
          type,
          scheduleId,
          customerId,
          err: err?.message || String(err)
        });
      }
    }

    const nextPlanTier = hasPendingUpdate ? prevTier : computedTier;
    const nextStripePriceId = hasPendingUpdate ? prevStripePriceId : priceId;
    const nextPendingTier = hasPendingUpdate ? pendingTier : schedulePendingTier;
    const nextPendingEffectiveAt =
      hasPendingUpdate && pendingTier ? new Date() : schedulePendingEffectiveAt;

    const { rows: updatedRows, rowCount: updatedRowCount } = await pool.query(
      `UPDATE users
          SET plan_tier = $1,
              plan_started_at = CASE
                WHEN plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2::timestamptz IS NOT NULL THEN $2::timestamptz
                ELSE plan_started_at
              END,
              plan_started_tier = CASE
                WHEN plan_started_tier IS NULL AND plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2::timestamptz IS NOT NULL THEN $1
                ELSE plan_started_tier
              END,
              plan_expires_at = COALESCE($3::timestamptz, plan_expires_at),
              plan_autorenew = $4,
              stripe_customer_id = $5,
              stripe_subscription_id = $6,
              stripe_price_id = $7,
              stripe_subscription_status = $8,
              billing_currency = $9,
              updated_at = NOW(),
              pending_plan_tier = $10,
              pending_plan_effective_at = $11::timestamptz
        WHERE stripe_customer_id = $5
        RETURNING chat_id`,
      [
        nextPlanTier,
        periodStart,
        periodEnd,
        autoRenew,
        customerId,
        subscription.id,
        nextStripePriceId,
        status,
        currency,
        nextPendingTier,
        nextPendingEffectiveAt
      ]
    );

    let updatedChatId = updatedRows[0]?.chat_id || prevChatId || null;

    if (!updatedChatId) {
      // If the user row wasn't linked by stripe_customer_id yet, fall back to the chat_id we inferred
      // from the event for payment tracking (e.g. via metadata or client_reference_id in other event types).
      if (paymentChatId && updatedRowCount === 0) {
        console.warn('Stripe subscription update matched 0 users; falling back to chat_id', {
          eventId: event.id,
          type,
          customerId,
          subscriptionId: subscription.id,
          chatId: paymentChatId
        });
        const { rows: fallbackRows } = await pool.query(
          `UPDATE users
              SET plan_tier = $1,
                  plan_started_at = CASE
                    WHEN plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2::timestamptz IS NOT NULL THEN $2::timestamptz
                    ELSE plan_started_at
                  END,
                  plan_started_tier = CASE
                    WHEN plan_started_tier IS NULL AND plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2::timestamptz IS NOT NULL THEN $1
                    ELSE plan_started_tier
                  END,
                  plan_expires_at = COALESCE($3::timestamptz, plan_expires_at),
                  plan_autorenew = $4,
                  stripe_customer_id = $5,
                  stripe_subscription_id = $6,
                  stripe_price_id = $7,
                  stripe_subscription_status = $8,
                  billing_currency = $9,
                  updated_at = NOW(),
                  pending_plan_tier = $10,
                  pending_plan_effective_at = $11::timestamptz
            WHERE chat_id = $12
            RETURNING chat_id`,
          [
            nextPlanTier,
            periodStart,
            periodEnd,
            autoRenew,
            customerId,
            subscription.id,
            nextStripePriceId,
            status,
            currency,
            nextPendingTier,
            nextPendingEffectiveAt,
            paymentChatId
          ]
        );
        updatedChatId = fallbackRows[0]?.chat_id || null;
      }
    }

    if (updatedChatId && prevTier !== nextPlanTier) {
      await notifyPlanChanged({
        chat_id: updatedChatId,
        old_tier: prevTier,
        new_tier: nextPlanTier,
        status,
        autorenew: autoRenew,
        period_end: periodEnd?.toISOString() || null,
        price_id: nextStripePriceId,
        currency
      });
    }
  }

  if (type === 'customer.subscription.deleted') {
    const subscription = obj;
    const { rows: prevRows } = await pool.query(
      `SELECT chat_id, plan_tier
         FROM users
        WHERE stripe_customer_id = $1
        LIMIT 1`,
      [subscription.customer]
    );
    const prevTier = prevRows[0]?.plan_tier || 'free';
    const prevChatId = prevRows[0]?.chat_id || null;

    const { rows: updatedRows } = await pool.query(
      `UPDATE users
          SET plan_tier = 'free',
              plan_expires_at = NOW(),
              plan_autorenew = false,
              stripe_subscription_status = $1,
              updated_at = NOW()
        WHERE stripe_customer_id = $2
        RETURNING chat_id`,
      [subscription.status, subscription.customer]
    );

    const updatedChatId = updatedRows[0]?.chat_id || prevChatId;
    if (updatedChatId && prevTier !== 'free') {
      await notifyPlanChanged({
        chat_id: updatedChatId,
        old_tier: prevTier,
        new_tier: 'free',
        status: subscription.status || 'canceled',
        autorenew: false,
        period_end: null,
        price_id: null,
        currency: subscription.currency?.toUpperCase() || 'EUR'
      });
    }
  }
}

const apiBoss = await getApiBoss();

async function shutdown(signal) {
  console.log(`API shutting down on ${signal}`);
  await stopApiBoss();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('API shutdown failed', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('API shutdown failed', error);
    process.exit(1);
  });
});

app.locals.apiBoss = apiBoss;

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
