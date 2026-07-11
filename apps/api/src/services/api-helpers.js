import {
  buildBillingCurrencyCatalog,
  getBillingCurrenciesForBaseLanguage,
  getBillingCurrencyDetails
} from '../billing-currencies.js';
import {
  normalizeEffectiveTopicAccessTier,
  normalizeTopicAccessTier,
  normalizeTopicEmoji,
  normalizeTopicId,
  normalizeTopicPayload,
  normalizeTopicRow,
  topicIsVisibleForTier
} from '../topic-catalog.js';
import {
  clampInteger,
  clampNumber,
  normalizeBillingInterval,
  normalizeBotKey,
  normalizeCurrencyCode,
  normalizeLanguageCode,
  normalizeOptionalText,
  normalizeRuntimeCurrencyCode,
  parseChatIdList,
  parsePositiveInteger,
  parseQueryBoolean
} from '../shared/normalization.js';
import { httpError } from '../core/errors.js';
import { captureException } from '../sentry.js';
import {
  classifyPermanentTelegramFailure,
  sanitizeErrorText
} from '../shared/telegram-delivery.js';
import { enqueueDiscordEventNotificationJob } from '../jobs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOADER_MESSAGE_MAX_LEN = 4096;
const MINIAPP_FEEDBACK_MESSAGE_MAX_LEN = 1000;
const ACTIVE_STRIPE_BILLING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);
const BROADCAST_ALLOWED_TIERS = new Set(['free', 'plus', 'pro']);
const BROADCAST_LAST_ACTIVITY_MODES = new Set(['active_within', 'inactive_for', 'never_active']);
const BROADCAST_USAGE_MODES = new Set(['reached', 'percent_gte']);
const BROADCAST_STREAK_MODES = new Set(['gte', 'zero']);
const BROADCAST_MESSAGE_MAX_LEN = 4096;
const BROADCAST_MESSAGE_KINDS = new Set(['text', 'photo', 'video']);
const BROADCAST_CAPTION_MAX_LEN = 1024;
const BROADCAST_MEDIA_URL_MAX_LEN = 2048;
const BROADCAST_MEDIA_FILE_ID_MAX_LEN = 512;
const BROADCAST_INLINE_KEYBOARD_MAX_ROWS = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN = 2048;
const PLAN_CHANGED_TEXT_BY_LANGUAGE = {
  ar: 'تم تغيير خطتك',
  de: 'Dein Tarif wurde geändert',
  en: 'Your plan has changed',
  hi: 'आपका प्लान बदल गया है',
  it: 'Il tuo piano è stato modificato',
  tr: 'Planın değiştirildi',
  uk: 'Твій план змінено'
};

const billingCurrencyDetailsByCode = getBillingCurrencyDetails();
const supportedBillingCurrencyCodes = new Set(Object.keys(billingCurrencyDetailsByCode));

function makeHttpError(status, code, detail = '') {
  const err = new Error(detail || code);
  err.status = status;
  err.code = code;
  err.detail = detail || code;
  return err;
}

function normalizeTopicSeedList(raw, { maxItems = 6, maxItemLen = 80 } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((value) => value.slice(0, maxItemLen));
}

function normalizeTopicAssistDraft(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw makeHttpError(400, 'bad_draft', 'draft must be an object');
  }
  return normalizeTopicPayload(raw, { requireAll: true });
}

function normalizeTopicBaseTemplate(raw, fallbackTopicName = '') {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw makeHttpError(400, 'bad_base_template', 'base_template must be an object');
  }

  const topicId = normalizeTopicId(raw.topic_id ?? fallbackTopicName);
  return {
    topic_id: topicId,
    emoji: normalizeTopicEmoji(raw.emoji, topicId),
    access_tier: normalizeTopicAccessTier(raw.access_tier ?? 'all'),
    title_base:
      normalizeOptionalText(raw.title_base ?? raw.title, 120) ||
      normalizeOptionalText(fallbackTopicName, 120) ||
      topicId,
    goal_base:
      normalizeOptionalText(raw.goal_base ?? raw.goal, 280) ||
      normalizeOptionalText(fallbackTopicName, 280) ||
      topicId,
    allowed_base: normalizeTopicSeedList(raw.allowed_base ?? raw.allowed),
    avoid_base: normalizeTopicSeedList(raw.avoid_base ?? raw.avoid),
    sort_order: Number.isInteger(Number(raw.sort_order)) ? Number(raw.sort_order) : 0
  };
}

export function createApiHelpers(ctx) {
  const {
    env,
    pool,
    stripe,
    botConfigs,
    publicBotCatalog,
    publicBotCatalogByKey,
    publicBotMetaForKey,
    getBotLocale,
    telegramClient,
    deliveryState,
    actionEvents,
    apiBoss
  } = ctx;
  const { recordActionEventSafe } = actionEvents;
  const {
    sendTelegramTextMessage,
    uploadTelegramMediaToChat,
    deleteTelegramMessage
  } = telegramClient;
  const { updateUserDeliveryState } = deliveryState;

  function adminTopicBots() {
    return publicBotCatalog.map((bot) => ({
      bot_key: bot.bot_key,
      base_language: bot.base_language || null,
      learning_language: bot.learning_language || null,
      bot_name: bot.bot_name || null
    }));
  }

  async function queueDiscordEventNotification(event, { singletonKey } = {}) {
    if (!apiBoss || !env.discordEventsWebhookUrl) return null;
    try {
      return await enqueueDiscordEventNotificationJob(apiBoss, event, { singletonKey });
    } catch (error) {
      console.error('discord event enqueue failed', {
        type: event?.type || null,
        singletonKey: singletonKey || null,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { subsystem: 'discord-event-enqueue', event_type: event?.type || 'unknown' },
        extra: { singletonKey: singletonKey || null }
      });
      return null;
    }
  }

  function requireTopicBotMeta(botKeyRaw) {
    const botKey = normalizeBotKey(botKeyRaw);
    if (!botKey) throw makeHttpError(400, 'bad_bot_key', 'bot_key is required');
    const meta = publicBotMetaForKey(botKey);
    if (!meta) throw makeHttpError(404, 'bot_not_found', `Unknown bot_key: ${botKey}`);
    return meta;
  }

  function serializeTopicRow(row) {
    return normalizeTopicRow(row);
  }

  async function fetchTopicCatalogItem(botKey, topicId) {
    const { rows } = await pool.query(
      `SELECT
         bot_key,
         topic_id,
         emoji,
         access_tier,
         title_base,
         goal_base,
         allowed_base,
         subareas_json,
         avoid_base,
         starter_questions_target,
         recovery_questions_target,
         sort_order,
         created_at,
         updated_at,
         topic_mode,
         speech_acts_base,
         lexical_anchors_target,
         grammar_targets_json,
         starter_questions_by_level_target,
         recovery_questions_by_level_target,
         bridge_patterns_target,
         hard_block_base,
         soft_redirect_base,
         opening_prompt_target
       FROM bot_topic_catalog
       WHERE bot_key = $1
         AND topic_id = $2
       LIMIT 1`,
      [botKey, topicId]
    );
    return serializeTopicRow(rows[0]);
  }

  async function fetchTopicCatalogRows(botKey, { userTier = null } = {}) {
    const { rows } = await pool.query(
      `SELECT
         bot_key,
         topic_id,
         emoji,
         access_tier,
         title_base,
         goal_base,
         allowed_base,
         subareas_json,
         avoid_base,
         starter_questions_target,
         recovery_questions_target,
         sort_order,
         created_at,
         updated_at,
         topic_mode,
         speech_acts_base,
         lexical_anchors_target,
         grammar_targets_json,
         starter_questions_by_level_target,
         recovery_questions_by_level_target,
         bridge_patterns_target,
         hard_block_base,
         soft_redirect_base,
         opening_prompt_target
       FROM bot_topic_catalog
       WHERE bot_key = $1
       ORDER BY sort_order ASC, topic_id ASC`,
      [botKey]
    );
    const items = rows.map(serializeTopicRow).filter(Boolean);
    if (!userTier) return items;
    return items.filter((row) => topicIsVisibleForTier(row, userTier));
  }

  function normalizeTopicRequestBody(body, { existingTopic = null } = {}) {
    const payload = normalizeTopicPayload(body || {}, { existingTopic });
    return {
      ...payload,
      access_tier_value: payload.access_tier,
      allowed_base_json: JSON.stringify(payload.allowed_base),
      subareas_json_json: JSON.stringify(payload.subareas_json),
      avoid_base_json: JSON.stringify(payload.avoid_base),
      starter_questions_target_json: JSON.stringify(payload.starter_questions_target),
      recovery_questions_target_json: JSON.stringify(payload.recovery_questions_target),
      speech_acts_base_json: JSON.stringify(payload.speech_acts_base),
      lexical_anchors_target_json: JSON.stringify(payload.lexical_anchors_target),
      grammar_targets_json_value: JSON.stringify(payload.grammar_targets_json),
      starter_questions_by_level_target_json: JSON.stringify(payload.starter_questions_by_level_target),
      recovery_questions_by_level_target_json: JSON.stringify(payload.recovery_questions_by_level_target),
      bridge_patterns_target_json: JSON.stringify(payload.bridge_patterns_target),
      hard_block_base_json: JSON.stringify(payload.hard_block_base),
      soft_redirect_base_json: JSON.stringify(payload.soft_redirect_base),
      opening_prompt_target_value: payload.opening_prompt_target,
      topic_mode_value: payload.topic_mode
    };
  }

  async function fetchEffectiveTierForChat(chatIdRaw) {
    const chatId = Number(chatIdRaw);
    if (!Number.isFinite(chatId) || chatId <= 0) return 'free';
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN override_plan_tier IS NOT NULL AND override_expires_at IS NOT NULL AND NOW() < override_expires_at
             THEN override_plan_tier
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN plan_tier
           ELSE 'free'
         END AS effective_tier
       FROM users
       WHERE chat_id = $1
       LIMIT 1`,
      [chatId]
    );
    return normalizeEffectiveTopicAccessTier(rows[0]?.effective_tier || 'free');
  }

  async function fetchLoaderState(chatId, botKey) {
    const normalizedChatId = Number(chatId);
    const normalizedBotKey = normalizeBotKey(botKey);
    if (!Number.isFinite(normalizedChatId) || normalizedChatId <= 0 || !normalizedBotKey) return null;

    const { rows } = await pool.query(
      `SELECT chat_id, bot_key, stop_flag, updated_at, session_id, message_id, started_at
         FROM loader_flags
        WHERE chat_id = $1
          AND bot_key = $2
        LIMIT 1`,
      [normalizedChatId, normalizedBotKey]
    );
    return rows[0] || null;
  }

  async function upsertLoaderState({ chatId, botKey, sessionId, messageId }) {
    await pool.query(
      `INSERT INTO loader_flags (chat_id, bot_key, session_id, message_id, stop_flag, started_at, updated_at)
       VALUES ($1, $2, $3, $4, false, NOW(), NOW())
       ON CONFLICT (chat_id, bot_key) DO UPDATE SET
         session_id = EXCLUDED.session_id,
         message_id = EXCLUDED.message_id,
         stop_flag = false,
         started_at = NOW(),
         updated_at = NOW()`,
      [Number(chatId), normalizeBotKey(botKey), normalizeLoaderSessionId(sessionId), normalizeLoaderMessageId(messageId)]
    );
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

  function normalizeTopicPackValue(raw) {
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

  function formatTopicMenuLabel(item = {}, locale = {}, { userTier = null } = {}) {
    const emoji = String(item.emoji || '🧩').trim();
    const title = String(item.title_base || item.topic_id || '').trim();
    if (!emoji && !title) return '';
    const base = `${emoji} ${title}`.trim();
    const accessTier = String(item.access_tier || 'all').trim().toLowerCase();
    if (accessTier !== 'pro') return base;
    const effectiveTier = userTier == null ? null : normalizeEffectiveTopicAccessTier(userTier);
    const fallbackSuffix = effectiveTier === 'pro' ? '✅ PRO' : '🔒 PRO';
    const suffix = String(locale.topic_menu_pro_suffix || fallbackSuffix).trim() || fallbackSuffix;
    return `${base} ${suffix}`.trim();
  }

  function buildTopicMenuReplyMarkup(items = [], locale = {}, { userTier = null } = {}) {
    const keyboard = items.map((item) => ({
      text: formatTopicMenuLabel(item, locale, { userTier }),
      callback_data: `topic:${String(item.topic_id || '').trim().toLowerCase()}`
    }))
      .filter((button) => button.text && button.callback_data !== 'topic:')
      .map((button) => [button]);

    keyboard.push([
      {
        text: `🧹 ${String(locale.topic_btn_clear || 'Clear topic').trim()}`.trim(),
        callback_data: 'topic:clear'
      }
    ]);

    return { inline_keyboard: keyboard };
  }

  function getAllowedBillingCurrencies(baseLanguageRaw) {
    const currencies = getBillingCurrenciesForBaseLanguage(baseLanguageRaw)
      .map((currency) => normalizeRuntimeCurrencyCode(currency))
      .filter(Boolean);
    return currencies.length ? currencies : ['EUR'];
  }

  function getBillingCurrencyDetailsForCurrencies(currencies = []) {
    const details = {};
    for (const rawCurrency of currencies) {
      const currency = normalizeRuntimeCurrencyCode(rawCurrency);
      if (!currency) continue;
      if (!billingCurrencyDetailsByCode[currency]) continue;
      details[currency] = { ...billingCurrencyDetailsByCode[currency] };
    }
    return details;
  }

  function resolvePlanCurrencySelection({
    requestedCurrency,
    allowedCurrencies,
    billingCurrency,
    preferredCurrency,
    allowBillingCurrency = false
  }) {
    const allowed = Array.from(
      new Set((allowedCurrencies || []).map((item) => normalizeRuntimeCurrencyCode(item)).filter(Boolean))
    );
    const allowedSet = new Set(allowed);
    const requested = normalizeRuntimeCurrencyCode(requestedCurrency);
    if (requested && allowedSet.has(requested)) return requested;

    const actualBillingCurrency = normalizeRuntimeCurrencyCode(billingCurrency);
    if (allowBillingCurrency && actualBillingCurrency && allowedSet.has(actualBillingCurrency)) {
      return actualBillingCurrency;
    }

    const preferred = normalizeRuntimeCurrencyCode(preferredCurrency);
    if (preferred && allowedSet.has(preferred)) return preferred;

    return allowed[0] || 'EUR';
  }

  function isStripeBackedPaidStatus(statusRaw) {
    const status = (statusRaw ?? '').toString().trim().toLowerCase();
    return ACTIVE_STRIPE_BILLING_STATUSES.has(status);
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
           u.plan_autorenew,
           u.billing_currency,
           u.preferred_billing_currency,
           u.stripe_subscription_status
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

  function buildPlanCatalogResponse({
    currency,
    plans,
    user = null,
    usage = null,
    baseLanguage = null,
    availableCurrencies = []
  }) {
    return {
      currency,
      base_language: baseLanguage || null,
      available_currencies: availableCurrencies,
      currency_details: getBillingCurrencyDetailsForCurrencies(availableCurrencies),
      user,
      plans,
      usage
    };
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

  async function archiveStripePriceSafely(priceId) {
    const normalizedPriceId = String(priceId || '').trim();
    if (!normalizedPriceId) return;
    try {
      await stripe.prices.update(normalizedPriceId, { active: false });
    } catch (err) {
      console.warn('Admin Stripe product price cleanup archive failed', {
        priceId: normalizedPriceId,
        err: err?.message || String(err)
      });
    }
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

  async function getUserXpSummary(chatIdRaw, botKeyRaw) {
    const chatId = Number(chatIdRaw);
    const botKey = normalizeBotKey(botKeyRaw);
    if (!Number.isFinite(chatId) || !botKey) {
      return {
        total: 0,
        level: 1,
        streak_bonus_applied: false
      };
    }

    const { rows } = await pool.query(
      `SELECT
         COALESCE(up.xp_total, 0)::int AS xp_total,
         FLOOR(COALESCE(up.xp_total, 0) / 200.0)::int + 1 AS xp_level
       FROM user_progress up
       WHERE up.chat_id = $1
         AND up.bot_key = $2
       LIMIT 1`,
      [chatId, botKey]
    );

    const row = rows[0] || null;
    return {
      total: Number(row?.xp_total || 0),
      level: Number(row?.xp_level || 1) || 1,
      streak_bonus_applied: false
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
    const defaultTo = new Date(todayUtc.getTime() + DAY_MS);
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
      const normalized = raw.map((value) => normalizeBotKey(value)).filter(Boolean);
      return Array.from(new Set(normalized));
    }
    const text = (raw ?? '').toString().trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((value) => normalizeBotKey(value)).filter(Boolean);
        return Array.from(new Set(normalized));
      }
    } catch {
      // ignore
    }
    const normalized = text
      .split(',')
      .map((value) => normalizeBotKey(value))
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
      ? Array.from(new Set(botKeysRaw.map((value) => normalizeBotKey(value)).filter(Boolean)))
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

  function normalizeLoaderMessages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value) => (value ?? '').toString().trim())
      .filter(Boolean)
      .map((value) => value.slice(0, LOADER_MESSAGE_MAX_LEN))
      .slice(0, 32);
  }

  function normalizeLoaderWaitingText(raw) {
    const value = (raw ?? '').toString().trim();
    return value ? value.slice(0, LOADER_MESSAGE_MAX_LEN) : '';
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

  async function stopAndDeleteLoader(chatId, botKey, sessionId = null) {
    const state = await fetchLoaderState(chatId, botKey);
    if (!state) return null;

    const requestedSessionId = normalizeLoaderSessionId(sessionId);
    if (requestedSessionId && state.session_id !== requestedSessionId) {
      return null;
    }
    const effectiveSessionId = requestedSessionId || state.session_id;

    await markLoaderStopped(chatId, botKey, effectiveSessionId);

    if (state.message_id) {
      try {
        await deleteTelegramMessage(chatId, state.message_id, { botKey });
      } catch (error) {
        if (!isTelegramMessageGoneError(error)) {
          console.warn('loader-stop:delete-failed', {
            chatId,
            botKey,
            sessionId: effectiveSessionId,
            error: error?.telegramDescription || error?.message || String(error)
          });
        }
      }
    }

    await markLoaderStopped(chatId, botKey, effectiveSessionId, { clearMessageId: true });
    return {
      session_id: effectiveSessionId,
      message_id: state.message_id
    };
  }

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

  async function upsertUser(user, { botKey = null } = {}) {
    const chatId = user.id;
    const username = user.username || null;
    const firstName = user.first_name || null;
    const normalizedBotKey = normalizeBotKey(botKey);
    const botKeyForContext = normalizedBotKey || normalizeBotKey(env.defaultBotKey);
    const insertResult = await pool.query(
      `INSERT INTO users (chat_id, username, first_name, inactive_reason, inactive_at, last_delivery_error)
       VALUES ($1, $2, $3, NULL, NULL, NULL)
       ON CONFLICT (chat_id) DO NOTHING
       RETURNING chat_id`,
      [chatId, username, firstName]
    );

    const isNewUser = insertResult.rowCount > 0;
    if (!isNewUser) {
      await pool.query(
        `UPDATE users
            SET username = $2,
                first_name = $3,
                inactive_reason = NULL,
                inactive_at = NULL,
                last_delivery_error = NULL,
                updated_at = NOW()
          WHERE chat_id = $1`,
        [chatId, username, firstName]
      );
    }

    if (isNewUser && env.discordUserMilestoneStep > 0) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total_users
           FROM users`
      );
      const totalUsers = Number(rows[0]?.total_users || 0);
      if (
        Number.isFinite(totalUsers)
        && totalUsers > 0
        && totalUsers % env.discordUserMilestoneStep === 0
      ) {
        await queueDiscordEventNotification(
          {
            type: 'user_milestone',
            milestone: totalUsers,
            total_users: totalUsers,
            chat_id: chatId,
            username,
            first_name: firstName,
            bot_key: botKeyForContext
          },
          { singletonKey: `discord_event:user_milestone:${totalUsers}` }
        );
      }
    }

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
    try {
      const botKey = await resolveUserBotKey(payload?.chat_id);
      const chatId = Number(payload?.chat_id);
      if (!Number.isFinite(chatId)) return;

      const locale = getBotLocale(botKey);
      const baseLanguage = normalizeLanguageCode(
        publicBotMetaForKey(botKey)?.base_language || botKey?.split('-')[0] || 'en'
      ) || 'en';
      const oldTier = normalizeOptionalText(locale?.[`tier_${payload?.old_tier}`], 40)
        || normalizeOptionalText(payload?.old_tier, 40)?.toUpperCase()
        || '-';
      const newTier = normalizeOptionalText(locale?.[`tier_${payload?.new_tier}`], 40)
        || normalizeOptionalText(payload?.new_tier, 40)?.toUpperCase()
        || '-';
      const prefix = PLAN_CHANGED_TEXT_BY_LANGUAGE[baseLanguage]
        || PLAN_CHANGED_TEXT_BY_LANGUAGE.en;
      const emoji = payload?.new_tier === 'free' ? 'ℹ️' : '🎉';

      await sendTelegramTextMessage(
        chatId,
        `${emoji} ${prefix}: ${oldTier} → ${newTier} ✨`,
        { botKey }
      );
    } catch (err) {
      console.error('Plan change Telegram notification failed', err);
      captureException(err, { tags: { subsystem: 'plan-change-telegram' } });
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
        `SELECT chat_id, plan_tier, stripe_price_id, plan_started_at, username, first_name
           FROM users
          WHERE stripe_customer_id = $1
          LIMIT 1`,
        [customerId]
      );
      const prevTier = prevRows[0]?.plan_tier || 'free';
      const prevStripePriceId = prevRows[0]?.stripe_price_id || null;
      const prevChatId = prevRows[0]?.chat_id || null;
      const prevPlanStartedAt = prevRows[0]?.plan_started_at || null;
      const prevUsername = prevRows[0]?.username || null;
      const prevFirstName = prevRows[0]?.first_name || null;

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
          for (let index = 0; index < phases.length; index += 1) {
            const phase = phases[index];
            const start = typeof phase?.start_date === 'number' ? phase.start_date : null;
            const end = typeof phase?.end_date === 'number' ? phase.end_date : null;
            if (start === null) continue;
            const isCurrent = start <= nowSec && (end === null || nowSec < end);
            if (isCurrent) {
              currentIndex = index;
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

      const firstPaidTier = nextPlanTier === 'plus' || nextPlanTier === 'pro';
      if (updatedChatId && firstPaidTier && !prevPlanStartedAt) {
        const notificationBotKey = await resolveUserBotKey(updatedChatId);
        await queueDiscordEventNotification(
          {
            type: 'new_paid_user',
            chat_id: updatedChatId,
            username: prevUsername,
            first_name: prevFirstName,
            bot_key: notificationBotKey,
            plan_tier: nextPlanTier,
            status,
            price_id: nextStripePriceId,
            currency,
            subscription_id: subscription.id || null
          },
          { singletonKey: `discord_event:new_paid_user:${updatedChatId}` }
        );
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

  return {
    BROADCAST_CAPTION_MAX_LEN,
    BROADCAST_MEDIA_FILE_ID_MAX_LEN,
    BROADCAST_MEDIA_URL_MAX_LEN,
    BROADCAST_MESSAGE_KINDS,
    BROADCAST_MESSAGE_MAX_LEN,
    MINIAPP_FEEDBACK_MESSAGE_MAX_LEN,
    billingCurrencyDetailsByCode,
    supportedBillingCurrencyCodes,
    adminTopicBots,
    archiveStripePriceSafely,
    assertManagedStripePrice,
    botKeyFromTargetLang,
    buildBillingPriceKey,
    buildBillingCurrencyCatalog: (options) => buildBillingCurrencyCatalog(publicBotCatalog, options),
    buildPlanCatalogResponse,
    buildTopicMenuReplyMarkup,
    formatTopicMenuLabel,
    classifyPermanentTelegramFailure,
    clampInteger,
    compareBillingRows,
    fetchEffectiveTierForChat,
    fetchTopicCatalogItem,
    fetchTopicCatalogRows,
    getAllowedBillingCurrencies,
    getBotLocale,
    getBroadcastAudiencePreview,
    getManagedStripePrice,
    getMeUserRow,
    getStripeBillingProductId,
    getUserFeedbackSummary,
    getUserFeedbackThread,
    getUserStreakSummary,
    getUserUsageSummary,
    getUserXpSummary,
    handleStripeEvent,
    isStripeBackedPaidStatus,
    listAvailableBotsForUser,
    listBroadcastRecipients,
    listStripeBillingProductPrices,
    listUserBots,
    loadAdminBillingSnapshot,
    loadPlanCatalog,
    loadRuntimePlanPrices,
    normalizeBroadcastFilters,
    normalizeBroadcastMediaFileIds,
    normalizeBroadcastReplyMarkup,
    normalizeLoaderMessageId,
    normalizeLoaderMessages,
    normalizeLoaderSessionId,
    normalizeLoaderWaitingText,
    normalizeTopicAssistDraft,
    normalizeTopicBaseTemplate,
    normalizeTopicPackValue,
    normalizeTopicRequestBody,
    parseAdminChatIdTarget,
    parseAdminFeedbackThreadTarget,
    parseAdminRange,
    parseBotKeysField,
    parsePositiveInteger,
    parseQueryBoolean,
    publicBotCatalog,
    publicBotMetaForKey,
    recordActionEventSafe,
    requestedBotKeyFromReq,
    requireTopicBotMeta,
    resolvePlanCurrencySelection,
    resolveTierByPrice,
    resolveUserBotKey,
    sanitizeErrorText,
    sendTelegramTextMessage,
    serializeTopicRow,
    stopAndDeleteLoader,
    summarizeBillingEntry,
    targetLangFromBotKey,
    updateUserDeliveryState,
    uploadTelegramMediaToChat,
    upsertLoaderState,
    upsertUser,
    validateBroadcastBotSelection,
    withBroadcastStreakRange
  };
}
