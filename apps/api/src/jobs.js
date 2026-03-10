import { env } from './env.js';
import { pool } from './db.js';
import { loadBotConfigs } from './bot-configs.js';
import {
  QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
  QUEUE_BROADCAST_RECIPIENT_SEND,
  QUEUE_ONBOARDING_COMPLETE_SCAN,
  QUEUE_ONBOARDING_COMPLETE_SEND,
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

async function sendTelegramTextMessage(chatId, text, { botKey = null, parseMode = null, replyMarkup = null } = {}) {
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

function getBotLocale(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return {};
  const config = botConfigs[botKey] || botConfigs[botKeyRaw] || {};
  return config.locale && typeof config.locale === 'object' ? config.locale : {};
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
  const testChatIds = env.scheduledTasksTestChatIds?.length ? env.scheduledTasksTestChatIds : null;
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
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleBroadcastCampaignEnqueue(jobs, boss)
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
