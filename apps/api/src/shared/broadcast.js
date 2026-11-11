import { clampInteger, clampNumber, normalizeBotKey, parseChatIdList } from './normalization.js';

export const BROADCAST_ALLOWED_TIERS = new Set(['free', 'pro']);
export const BROADCAST_LAST_ACTIVITY_MODES = new Set(['active_within', 'inactive_for', 'never_active']);
export const BROADCAST_USAGE_MODES = new Set(['reached', 'percent_gte']);
export const BROADCAST_STREAK_MODES = new Set(['gte', 'zero']);
export const BROADCAST_MESSAGE_KINDS = new Set(['text', 'photo', 'video']);
export const BROADCAST_MESSAGE_MAX_LEN = 4096;
export const BROADCAST_CAPTION_MAX_LEN = 1024;
export const BROADCAST_MEDIA_FILE_ID_MAX_LEN = 512;
export const BROADCAST_MEDIA_URL_MAX_LEN = 2048;
export const BROADCAST_MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const BROADCAST_INLINE_KEYBOARD_MAX_ROWS = 8;
export const BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW = 8;
export const BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN = 64;
export const BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN = 64;
export const BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN = 2048;

export function normalizeBroadcastFilters(raw) {
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

export function broadcastAudienceParams(filters, range) {
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

export function broadcastAudienceSql(selectSql, suffixSql = '') {
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

export function normalizeBroadcastMediaFileIds(raw) {
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

export function normalizeBroadcastReplyMarkup(raw) {
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
