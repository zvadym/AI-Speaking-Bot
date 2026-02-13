import { timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { pool } from './db.js';
import { verifyInitData } from './telegram.js';
import { stripe } from './stripe.js';
import { signSession, requireAuth } from './auth.js';
import { loadBotConfigs } from './bot-configs.js';

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
         ub.onboarding_state,
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
    level: row.level || 'b1',
    onboarding_state: row.onboarding_state || 'ready',
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
       ub.onboarding_state,
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
      onboarding_state: linked?.onboarding_state || null,
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
      onboarding_state: row?.onboarding_state || null,
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

  return { ok: true, from, to, payload };
}

const BROADCAST_ALLOWED_TIERS = new Set(['free', 'plus', 'pro']);
const BROADCAST_LAST_ACTIVITY_MODES = new Set(['active_within', 'inactive_for', 'never_active']);
const BROADCAST_USAGE_MODES = new Set(['reached', 'percent_gte']);
const BROADCAST_MESSAGE_MAX_LEN = 4096;
const broadcastInFlight = new Set();

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

  const botsProvided = Array.isArray(source.bots);
  const botsRaw = botsProvided ? source.bots : [];
  const bots = Array.from(
    new Set(
      botsRaw
        .map((v) => v.toString().trim().toLowerCase())
        .filter((v) => v.length > 0 && v.length <= 32)
    )
  );
  const normalizedBots = botsProvided && bots.length > 0 ? bots : null;

  return {
    username,
    plans: normalizedPlans,
    lastActivityMode,
    lastActivityDays,
    usageMode,
    usagePercent,
    bots: normalizedBots
  };
}

function broadcastAudienceParams(filters) {
  const plans = Array.isArray(filters.plans) ? filters.plans : null;
  const bots = Array.isArray(filters.bots) ? filters.bots : null;
  return [
    filters.username,
    plans,
    filters.lastActivityMode,
    filters.lastActivityDays,
    filters.usageMode,
    filters.usagePercent,
    bots
  ];
}

function broadcastAudienceSql(selectSql, suffixSql = '') {
  return `WITH effective_users AS (
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
      WHERE COALESCE(u.is_active, true) = true
        AND COALESCE(ub.is_active, true) = true
    ),
    last_activity AS (
      SELECT
        v.chat_id,
        MAX(v.occurred_at) AS last_activity_at
      FROM voice_usage_events v
      GROUP BY v.chat_id
    ),
    week_usage AS (
      SELECT
        w.chat_id,
        COALESCE(SUM(w.user_audio_seconds), 0)::int AS used_user,
        COALESCE(SUM(w.tts_seconds), 0)::int AS used_tts
      FROM usage_week w
      WHERE w.week_start = date_trunc('week', NOW())::date
      GROUP BY w.chat_id
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
        COALESCE(w.used_user, 0)::int AS used_user,
        COALESCE(w.used_tts, 0)::int AS used_tts,
        COALESCE(p.user_audio_seconds_per_week, 0)::int AS limit_user,
        COALESCE(p.tts_seconds_per_week, 0)::int AS limit_tts,
        GREATEST(
          CASE
            WHEN COALESCE(p.user_audio_seconds_per_week, 0) > 0
              THEN (COALESCE(w.used_user, 0)::numeric * 100.0) / p.user_audio_seconds_per_week
            ELSE 0
          END,
          CASE
            WHEN COALESCE(p.tts_seconds_per_week, 0) > 0
              THEN (COALESCE(w.used_tts, 0)::numeric * 100.0) / p.tts_seconds_per_week
            ELSE 0
          END
        )::numeric AS usage_percent,
        (
          (COALESCE(p.user_audio_seconds_per_week, 0) > 0 AND COALESCE(w.used_user, 0) >= p.user_audio_seconds_per_week)
          OR
          (COALESCE(p.tts_seconds_per_week, 0) > 0 AND COALESCE(w.used_tts, 0) >= p.tts_seconds_per_week)
        ) AS limit_reached
      FROM effective_users e
      LEFT JOIN last_activity a ON a.chat_id = e.chat_id
      LEFT JOIN week_usage w ON w.chat_id = e.chat_id
      LEFT JOIN plans p ON p.tier = e.effective_tier
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
        e.used_user,
        e.used_tts,
        e.limit_user,
        e.limit_tts,
        e.usage_percent,
        e.limit_reached
      FROM enriched e
      WHERE ($1::text IS NULL OR e.username ILIKE ('%' || $1::text || '%'))
        AND ($2::text[] IS NULL OR e.effective_tier = ANY($2::text[]))
        AND (
          $3::text IS NULL
          OR ($3::text = 'active_within'
              AND e.last_activity_at IS NOT NULL
              AND e.last_activity_at >= NOW() - make_interval(days => $4::int))
          OR ($3::text = 'inactive_for'
              AND (e.last_activity_at IS NULL OR e.last_activity_at < NOW() - make_interval(days => $4::int)))
          OR ($3::text = 'never_active' AND e.last_activity_at IS NULL)
        )
        AND (
          $5::text IS NULL
          OR ($5::text = 'reached' AND e.limit_reached)
          OR ($5::text = 'percent_gte' AND e.usage_percent >= $6::numeric)
        )
        AND ($7::text[] IS NULL OR e.bot_key = ANY($7::text[]))
    )
    SELECT ${selectSql}
    FROM filtered f
    ${suffixSql}`;
}

async function getBroadcastAudiencePreview(filters, sampleLimit = 20) {
  const params = broadcastAudienceParams(filters);
  const countQuery = broadcastAudienceSql('COUNT(*)::int AS count');
  const sampleQuery = broadcastAudienceSql(
    `f.chat_id,
     f.username,
     f.first_name,
     f.bot_key,
     f.effective_tier,
     f.last_activity_at,
     ROUND(f.usage_percent, 2)::numeric AS usage_percent,
     f.limit_reached`,
    'ORDER BY f.chat_id ASC, f.bot_key ASC LIMIT $8::int'
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

async function listBroadcastRecipients(filters, limit) {
  const params = broadcastAudienceParams(filters);
  const query = broadcastAudienceSql(
    `f.chat_id,
     f.username,
     f.first_name,
     f.bot_key`,
    'ORDER BY f.chat_id ASC, f.bot_key ASC LIMIT $8::int'
  );
  const { rows } = await pool.query(query, [...params, limit]);
  return rows;
}

function sanitizeErrorText(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;
  return raw.slice(0, 500);
}

function escapeTelegramHtml(value) {
  return (value ?? '')
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
          SET is_active = true,
              inactive_reason = NULL,
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
          SET is_active = a.has_active_bot,
              inactive_reason = CASE
                WHEN a.has_active_bot THEN NULL
                ELSE $2
              END,
              inactive_at = CASE
                WHEN a.has_active_bot THEN NULL
                WHEN COALESCE(u.is_active, true) THEN NOW()
                ELSE COALESCE(u.inactive_at, NOW())
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
          AND COALESCE(is_active, true) = true`,
      [chatId, lastError]
    );
  }
}

async function sendTelegramTextMessage(chatId, text, { botKey = null } = {}) {
  const token = resolveTelegramBotToken(botKey);
  if (!token) {
    const err = new Error('missing_telegram_bot_token');
    err.code = 'missing_telegram_bot_token';
    throw err;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: Number(chatId),
      text,
      disable_web_page_preview: true
    })
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

async function refreshBroadcastCampaignStats(campaignId, { status = null, errorText = null, setFinishedAt = false } = {}) {
  await pool.query(
    `WITH stats AS (
       SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
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

function queueBroadcastCampaignProcessing(campaignId) {
  const id = Number(campaignId);
  if (!Number.isFinite(id) || id <= 0) return;
  if (broadcastInFlight.has(id)) return;

  broadcastInFlight.add(id);
  setImmediate(async () => {
    try {
      await processBroadcastCampaign(id);
    } catch (err) {
      console.error('Broadcast processing failed', {
        campaignId: id,
        err: err?.message || String(err)
      });
    } finally {
      broadcastInFlight.delete(id);
    }
  });
}

async function processBroadcastCampaign(campaignId) {
  const id = Number(campaignId);
  if (!Number.isFinite(id) || id <= 0) return false;

  const { rows: lockRows } = await pool.query(
    `UPDATE broadcast_campaigns
        SET status = 'sending',
            started_at = COALESCE(started_at, NOW()),
            finished_at = NULL,
            error_text = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND (
          status = 'queued'
          OR (status = 'sending' AND updated_at < NOW() - interval '5 minutes')
        )
      RETURNING id, message_text`,
    [id]
  );
  if (!lockRows[0]) return false;

  const messageText = lockRows[0].message_text;
  const telegramSafeMessageText = escapeTelegramHtml(messageText);

  try {
    while (true) {
      const { rows: pendingRows } = await pool.query(
        `SELECT
           r.chat_id,
           r.bot_key
         FROM broadcast_recipients r
        WHERE r.campaign_id = $1
          AND r.status = 'pending'
        ORDER BY r.chat_id ASC, r.bot_key ASC
        LIMIT $2`,
        [id, env.broadcastProcessBatchSize]
      );
      if (pendingRows.length === 0) break;

      for (const row of pendingRows) {
        let status = 'sent';
        let lastError = null;
        let telegramMessageId = null;
        let inactiveReason = null;
        const recipientBotKey = normalizeBotKey(row.bot_key);
        const botKey = recipientBotKey || normalizeBotKey(env.defaultBotKey) || 'uk-de';

        try {
          // Send via n8n webhook instead of direct Telegram API
          const url = webhookUrlForBot(env.broadcastWebhookUrl, 'send-message', botKey);
          
          if (!url) {
            throw new Error('BROADCAST_WEBHOOK_URL not configured');
          }

          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: row.chat_id,
              message_text: telegramSafeMessageText,
              bot_key: botKey
            })
          });

          if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            throw new Error(`Webhook returned ${resp.status}: ${body}`);
          }

          // n8n webhook doesn't return message_id, so we leave it null
          // If needed, we can update n8n workflow to return it in the response
        } catch (err) {
          status = 'failed';
          lastError = sanitizeErrorText(err?.message || String(err));
          inactiveReason = classifyPermanentTelegramFailure(err);
        }

        await pool.query(
          `UPDATE broadcast_recipients
              SET status = $3,
                  attempts = attempts + 1,
                  last_error = $4,
                  sent_at = CASE
                    WHEN $3::text = 'sent' THEN NOW()
                    ELSE sent_at
                  END,
                  telegram_message_id = CASE
                    WHEN $5::bigint IS NOT NULL THEN $5::bigint
                    ELSE telegram_message_id
                  END,
                  updated_at = NOW()
            WHERE campaign_id = $1
              AND chat_id = $2
              AND (
                bot_key = $6
                OR (bot_key IS NULL AND $6 IS NULL)
              )`,
          [id, row.chat_id, status, lastError, telegramMessageId, recipientBotKey]
        );
        await updateUserDeliveryState(row.chat_id, { status, lastError, inactiveReason, botKey });

        if (env.broadcastPerMessageDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, env.broadcastPerMessageDelayMs));
        }
      }

      await refreshBroadcastCampaignStats(id);
    }

    await refreshBroadcastCampaignStats(id, { status: 'completed', setFinishedAt: true });
    return true;
  } catch (err) {
    await refreshBroadcastCampaignStats(id, {
      status: 'failed',
      errorText: sanitizeErrorText(err?.message || String(err)),
      setFinishedAt: true
    });
    return false;
  }
}

app.get('/admin/metrics/summary', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const { rows } = await pool.query(
    `WITH filtered AS (
     SELECT
       created_at,
       COALESCE(is_active, true) AS is_active,
       CASE
         WHEN override_plan_tier IS NOT NULL AND override_expires_at IS NOT NULL AND NOW() < override_expires_at
           THEN override_plan_tier
         WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
           THEN plan_tier
           ELSE 'free'
         END AS effective_tier
       FROM users
       WHERE ($1::text IS NULL OR acquisition_start_payload = $1)
     )
     SELECT
       COUNT(*)::int AS total_users_all_time,
       SUM((is_active)::int)::int AS active_users_all_time,
       SUM((effective_tier = 'plus')::int)::int AS plus_users_all_time,
       SUM((effective_tier = 'pro')::int)::int AS pro_users_all_time,
       COUNT(*) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz)::int AS total_users_in_range,
       SUM((is_active)::int) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz)::int AS active_users_in_range,
       SUM((effective_tier = 'plus')::int) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz)::int AS plus_users_in_range,
       SUM((effective_tier = 'pro')::int) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz)::int AS pro_users_in_range
     FROM filtered`,
    [range.payload, range.from.toISOString(), range.to.toISOString()]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    totals: rows[0] || {
      total_users_all_time: 0,
      active_users_all_time: 0,
      plus_users_all_time: 0,
      pro_users_all_time: 0,
      total_users_in_range: 0,
      active_users_in_range: 0,
      plus_users_in_range: 0,
      pro_users_in_range: 0
    }
  });
});

app.get('/admin/metrics/new-users-by-day', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

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
       GROUP BY 1
     )
     SELECT d.day_utc::text AS day, COALESCE(c.count, 0)::int AS count
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
       WHERE COALESCE(u.is_active, true) = false
         AND u.inactive_at IS NOT NULL
         AND u.inactive_at >= (SELECT from_ts FROM params)
         AND u.inactive_at < (SELECT to_ts FROM params)
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3)
       GROUP BY 1
     )
     SELECT d.day_utc::text AS day, COALESCE(c.count, 0)::int AS count
     FROM days d
     LEFT JOIN counts c USING (day_utc)
     ORDER BY d.day_utc ASC`,
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
    [range.from.toISOString(), range.to.toISOString(), range.payload]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payload: range.payload,
    series: rows
  });
});

app.get('/admin/metrics/active-users-by-hour', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

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
    [range.from.toISOString(), range.to.toISOString(), range.payload]
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
    [from.toISOString(), to.toISOString(), payload]
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

  const { rows } = await pool.query(
    `SELECT acquisition_start_payload AS payload, COUNT(*)::int AS users
       FROM users
      WHERE acquisition_start_payload IS NOT NULL
        AND created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
      GROUP BY acquisition_start_payload
      ORDER BY users DESC
      LIMIT 80`,
    [range.from.toISOString(), range.to.toISOString()]
  );

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payloads: rows
  });
});

app.get('/admin/feedbacks', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const kindRaw = (req.query.kind ?? '').toString().trim().toLowerCase();
  const kind = ['text', 'voice'].includes(kindRaw) ? kindRaw : null;
  const searchRaw = (req.query.search ?? '').toString().trim();
  const search = searchRaw ? searchRaw.slice(0, 120) : null;
  const limit = clampInteger(req.query.limit, { min: 1, max: 200, fallback: 50 });
  const offset = clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

  const params = [range.from.toISOString(), range.to.toISOString(), kind, search, limit, offset];
  const [totalRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
         FROM feedback f
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
          )`,
      params.slice(0, 4)
    ),
    pool.query(
      `SELECT
         f.id,
         f.created_at,
         f.chat_id,
         f.username,
         f.first_name,
         f.message_id,
         f.kind,
         f.feedback_text,
         f.transcript,
         f.telegram_file_id
       FROM feedback f
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
         )
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $5::int
       OFFSET $6::int`,
      params
    )
  ]);

  return res.json({
    tz: 'UTC',
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    kind,
    search,
    limit,
    offset,
    total: totalRes.rows[0]?.total || 0,
    items: rowsRes.rows || []
  });
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const limit = clampInteger(req.query.limit, { min: 1, max: 500, fallback: 100 });
  const offset = clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

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
      `SELECT
         u.chat_id,
         u.username,
         u.first_name,
         ub.bot_key,
         u.created_at,
         COALESCE(ub.last_seen_at, u.updated_at) AS last_seen_at,
         COALESCE(u.is_active, true) AS is_active,
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
       LEFT JOIN LATERAL (
         SELECT
           b.bot_key,
           b.last_seen_at
         FROM user_bots b
         WHERE b.chat_id = u.chat_id
         ORDER BY COALESCE(b.last_seen_at, b.updated_at, b.created_at) DESC, b.bot_key ASC
         LIMIT 1
       ) ub ON true
       WHERE u.created_at >= $1::timestamptz
         AND u.created_at < $2::timestamptz
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3::text)
       ORDER BY u.created_at DESC, u.chat_id DESC
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
    limit,
    offset,
    total: totalRes.rows[0]?.total || 0,
    items: rowsRes.rows || []
  });
});

app.post('/admin/broadcasts/preview', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const filters = normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
  const preview = await getBroadcastAudiencePreview(filters, 20);
  return res.json({
    filters,
    count: preview.count,
    sample: preview.sample
  });
});

app.post('/admin/broadcasts/send', requireAdmin, async (req, res) => {
  const filters = normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
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

  const recipients = await listBroadcastRecipients(filters, env.broadcastMaxRecipients + 1);
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

  let campaignId = null;
  await pool.query('BEGIN');
  try {
    const { rows: campaignRows } = await pool.query(
      `INSERT INTO broadcast_campaigns (
         status,
         filters,
         message_text,
         total_recipients,
         sent_count,
         failed_count,
         created_by
       )
       VALUES ('queued', $1::jsonb, $2::text, $3::int, 0, 0, $4::text)
       RETURNING id`,
      [JSON.stringify(filters), messageText, chatIds.length, createdBy]
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

  queueBroadcastCampaignProcessing(campaignId);

  return res.json({
    campaign_id: campaignId,
    status: 'queued',
    total_recipients: chatIds.length
  });
});

app.get('/admin/broadcasts/:id', requireAdmin, async (req, res) => {
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

app.post('/internal/broadcasts/process', async (req, res) => {
  if (!env.broadcastWebhookSecret) {
    return res.status(404).json({ error: 'not_found' });
  }

  const provided = (req.headers['x-broadcast-secret'] || '').toString();
  if (!provided || !safeEqualString(provided, env.broadcastWebhookSecret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const campaignIdRaw = req.body?.campaign_id ?? req.body?.campaignId;
  const campaignId = Number(campaignIdRaw);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: 'bad_campaign_id' });
  }

  queueBroadcastCampaignProcessing(campaignId);
  return res.json({ ok: true, campaign_id: campaignId });
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

  const { rows: userRows } = await pool.query(
    `SELECT plan_tier, plan_expires_at, plan_autorenew, pending_plan_tier, pending_plan_effective_at,
            override_plan_tier, override_expires_at, billing_currency, stripe_subscription_status
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const { rows: plans } = await pool.query(
    `SELECT p.tier, p.user_audio_seconds_per_week, p.tts_seconds_per_week,
            pp.currency, pp.amount_cents, pp.billing_interval, pp.stripe_price_id
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

  let usage = null;
  if (userRows[0]) {
    const { rows: usageRows } = await pool.query(
      `WITH u AS (
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
         FROM u
       ),
       p AS (
         SELECT
           tier,
           user_audio_seconds_per_week AS limit_user,
           tts_seconds_per_week AS limit_tts
         FROM plans
         WHERE tier = (SELECT effective_tier FROM effective)
         LIMIT 1
       ),
       w AS (
         SELECT
           COALESCE(user_audio_seconds, 0) AS used_user,
           COALESCE(tts_seconds, 0) AS used_tts
         FROM usage_week
         WHERE chat_id = (SELECT chat_id FROM effective)
           AND week_start = date_trunc('week', NOW())::date
         LIMIT 1
       )
       SELECT
         (SELECT effective_tier FROM effective) AS tier,
         (SELECT plan_expires_at FROM effective) AS plan_expires_at,
         (SELECT plan_autorenew FROM effective) AS plan_autorenew,
         (SELECT pending_plan_tier FROM effective) AS pending_plan_tier,
         (SELECT pending_plan_effective_at FROM effective) AS pending_plan_effective_at,
         (SELECT limit_user FROM p) AS limit_user,
         (SELECT limit_tts FROM p) AS limit_tts,
         COALESCE((SELECT used_user FROM w), 0) AS used_user,
         COALESCE((SELECT used_tts FROM w), 0) AS used_tts,
         GREATEST((SELECT limit_user FROM p) - COALESCE((SELECT used_user FROM w), 0), 0) AS remaining_user,
         GREATEST((SELECT limit_tts FROM p) - COALESCE((SELECT used_tts FROM w), 0), 0) AS remaining_tts`,
      [chatId]
    );
    usage = usageRows[0] || null;
  }

  return res.json({
    currency,
    user: userRows[0] || null,
    plans,
    usage
  });
});

app.get('/me', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const requestedBotKey = requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
  const user = await getMeUserRow(chatId, requestedBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user });
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
       onboarding_state,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     SELECT $1, $2, 'b1', 'await_level', 'text', 'marin', NOW(), NOW(), true, NOW()
     FROM users u
     WHERE u.chat_id = $1
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       onboarding_state = 'await_level',
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
       onboarding_state,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     SELECT $1, $2, $3, 'ready', 'text', 'marin', NOW(), NOW(), true, NOW()
     FROM users u
     WHERE u.chat_id = $1
     ON CONFLICT (chat_id, bot_key)
     DO UPDATE SET
       level = EXCLUDED.level,
       onboarding_state = 'ready',
       last_seen_at = NOW(),
       is_active = true,
       updated_at = NOW()`,
    [chatId, currentBotKey, raw]
  );

  if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
  const user = await getMeUserRow(chatId, currentBotKey);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
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
    `INSERT INTO users (chat_id, username, first_name, is_active, inactive_reason, inactive_at, last_delivery_error)
     VALUES ($1, $2, $3, true, NULL, NULL, NULL)
     ON CONFLICT (chat_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       is_active = true,
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
       onboarding_state,
       reply_mode,
       tts_voice,
       first_seen_at,
       last_seen_at,
       is_active,
       updated_at
     )
     VALUES ($1, $2, 'b1', 'ready', 'text', 'marin', NOW(), NOW(), true, NOW())
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

    await pool.query(
      `UPDATE users
          SET stripe_customer_id = $1,
              stripe_subscription_id = $2,
              stripe_subscription_status = $3,
              updated_at = NOW()
        WHERE chat_id = $4`,
      [session.customer, session.subscription, session.status, Number(session.client_reference_id)]
    );
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

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
