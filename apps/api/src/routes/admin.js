import { Router } from 'express';
import multer from 'multer';
import { createRequireAdmin } from '../middleware/admin.js';
import { captureException } from '../sentry.js';
import {
  normalizeBotKey,
  normalizeCurrencyCode,
  normalizeRuntimeCurrencyCode
} from '../shared/normalization.js';
import {
  enqueueBroadcastCampaign as enqueueBroadcastCampaignJob,
  getAutomatedMessageTestState,
  sendAdminTestDay1ReturnReminder,
  sendAdminTestIdiomPracticeReminder,
  sendAdminTestFreeLimitHalfReminder,
  sendAdminTestWeeklyDigestReminder,
  sendAdminTestWinbackReminder
} from '../jobs.js';
import { billingRouteErrorResponse } from '../core/errors.js';

const ACTION_EVENT_TYPES = [
  'start',
  'profile_set_level',
  'first_voice_sent',
  'first_answer_delivered',
  'onboarding_scenario_selected',
  'onboarding_practice_sent',
  'onboarding_completed',
  'onboarding_level_confirmed',
  'onboarding_bonus_selected',
  'day1_return',
  'free_limit_half',
  'paywall_shown',
  'purchase_success'
];
const REPLY_KEYBOARD_ACTION_TYPES = [
  'reply_kbd_level_click',
  'reply_kbd_voice_click',
  'idiom_phrase_more_click'
];
const NOTIFICATION_TASK_TYPES = [
  'onboarding_complete',
  'day1_return',
  'weekly_digest',
  'idiom_phrase_practice',
  'free_limit_50',
  'winback_d3',
  'winback_d7',
  'winback_d14'
];
const NOTIFICATION_SERIES_TYPES = [
  'onboarding_complete',
  'day1_return',
  'weekly_digest',
  'idiom_phrase_practice',
  'free_limit_50',
  'winback_d3',
  'winback_d7',
  'winback_d14',
  'broadcast_text',
  'broadcast_photo',
  'broadcast_video'
];
const DAY_MS = 24 * 60 * 60 * 1000;
const BROADCAST_MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const MAX_POSTGRES_BIGINT = 9223372036854775807n;

function parsePositiveBigintParam(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > MAX_POSTGRES_BIGINT) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseInclusiveUtcExpiry(raw, nowMs = Date.now()) {
  const expiresOn = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    return { ok: false, error: 'bad_expires_on' };
  }

  const start = new Date(`${expiresOn}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== expiresOn) {
    return { ok: false, error: 'bad_expires_on' };
  }

  const expiresAt = new Date(start.getTime() + DAY_MS);
  if (!Number.isFinite(expiresAt.getTime())) {
    return { ok: false, error: 'bad_expires_on' };
  }
  if (expiresAt.getTime() <= nowMs) {
    return { ok: false, error: 'expires_on_elapsed' };
  }

  return { ok: true, expiresOn, expiresAt };
}

function parseOptionalInclusiveUtcRange(fromRaw, toRaw, {
  dateError = 'bad_date',
  rangeError = 'bad_range'
} = {}) {
  const parseBoundary = (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return { value: null, date: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return { value, date };
  };

  const from = parseBoundary(fromRaw);
  const to = parseBoundary(toRaw);
  if (!from || !to) return { ok: false, error: dateError };

  const toExclusive = to.date ? new Date(to.date.getTime() + DAY_MS) : null;
  if (toExclusive && !Number.isFinite(toExclusive.getTime())) {
    return { ok: false, error: dateError };
  }
  if (from.date && toExclusive && from.date >= toExclusive) {
    return { ok: false, error: rangeError };
  }

  return {
    ok: true,
    from: from.date,
    toExclusive,
    fromValue: from.value,
    toValue: to.value
  };
}

export function createAdminRouter(ctx, helpers) {
  const router = Router();
  const requireAdmin = createRequireAdmin(ctx.env);
  const broadcastMediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BROADCAST_MEDIA_UPLOAD_MAX_BYTES }
  });

  router.get('/admin/metrics/summary', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
         SUM((effective_tier = 'pro')::int)::int AS pro_users_all_time,
         COUNT(*) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS total_users_in_range,
         SUM((is_active)::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS active_users_in_range,
         SUM((NOT is_active)::int) FILTER (WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz)::int AS inactive_users_in_range,
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
        pro_users_all_time: 0,
        total_users_in_range: 0,
        active_users_in_range: 0,
        inactive_users_in_range: 0,
        pro_users_in_range: 0
      }
    });
  });

  router.get('/admin/metrics/new-users-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/new-users-by-day-by-bot', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/new-paid-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
       first_paid_users AS (
         SELECT
           u.chat_id,
           date_trunc('day', u.plan_started_at AT TIME ZONE 'UTC')::date AS day_utc
         FROM filtered_users u, params
         WHERE u.plan_started_at IS NOT NULL
           AND u.plan_started_at >= (SELECT from_ts FROM params)
           AND u.plan_started_at < (SELECT to_ts FROM params)
           AND u.plan_started_tier IS NOT NULL
           AND u.plan_started_tier <> 'free'
       ),
       first_bot AS (
         SELECT
           pu.chat_id,
           pu.day_utc,
           COALESCE(ub.bot_key, 'unknown') AS bot_key
         FROM first_paid_users pu
         LEFT JOIN LATERAL (
           SELECT b.bot_key
           FROM user_bots b
           WHERE b.chat_id = pu.chat_id
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

  router.get('/admin/metrics/active-users-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
       activity_events AS (
         SELECT
           v.chat_id,
           v.bot_key,
           v.occurred_at
         FROM voice_usage_events v
         JOIN filtered_users u ON u.chat_id = v.chat_id

         UNION

         SELECT
           m.chat_id,
           m.bot_key,
           m.created_at AS occurred_at
         FROM messages m
         JOIN filtered_users u ON u.chat_id = m.chat_id
         WHERE m.role = 'user'

         UNION

         SELECT
           a.chat_id,
           a.bot_key,
           a.occurred_at
         FROM action_events a
         JOIN filtered_users u ON u.chat_id = a.chat_id
       ),
       first_activity AS (
         SELECT
           e.chat_id,
           MIN(date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date) AS first_day_utc
         FROM activity_events e
         GROUP BY e.chat_id
       ),
       daily_active AS (
         SELECT DISTINCT
           date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
           e.chat_id
         FROM activity_events e
         WHERE e.occurred_at >= (SELECT from_ts FROM params)
           AND e.occurred_at < (SELECT to_ts FROM params)
       ),
       counts AS (
         SELECT
           a.day_utc,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE f.first_day_utc = a.day_utc)::int AS new_users,
           COUNT(*) FILTER (WHERE f.first_day_utc < a.day_utc)::int AS returned_users
         FROM daily_active a
         JOIN first_activity f ON f.chat_id = a.chat_id
         GROUP BY 1
       )
       SELECT
         d.day_utc::text AS day,
         COALESCE(c.count, 0)::int AS count,
         COALESCE(c.new_users, 0)::int AS new_users,
         COALESCE(c.returned_users, 0)::int AS returned_users
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

  router.get('/admin/metrics/total-users-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
         SELECT chat_id, created_at
         FROM users
         WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
           AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
       ),
       baseline AS (
         SELECT COUNT(*)::int AS count
         FROM filtered_users
         WHERE created_at < (SELECT from_ts FROM params)
       ),
       created_counts AS (
         SELECT
           date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day_utc,
           COUNT(*)::int AS count
         FROM filtered_users
         WHERE created_at >= (SELECT from_ts FROM params)
           AND created_at < (SELECT to_ts FROM params)
         GROUP BY 1
       )
       SELECT
         d.day_utc::text AS day,
         (
           (SELECT count FROM baseline)
           + SUM(COALESCE(c.count, 0)) OVER (ORDER BY d.day_utc ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
         )::int AS count
       FROM days d
       LEFT JOIN created_counts c USING (day_utc)
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

  router.get('/admin/metrics/user-streaks', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/active-users-by-day-by-bot', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
       activity_events AS (
         SELECT
           v.chat_id,
           v.bot_key,
           v.occurred_at
         FROM voice_usage_events v
         JOIN filtered_users u ON u.chat_id = v.chat_id

         UNION

         SELECT
           m.chat_id,
           m.bot_key,
           m.created_at AS occurred_at
         FROM messages m
         JOIN filtered_users u ON u.chat_id = m.chat_id
         WHERE m.role = 'user'

         UNION

         SELECT
           a.chat_id,
           a.bot_key,
           a.occurred_at
         FROM action_events a
         JOIN filtered_users u ON u.chat_id = a.chat_id
         WHERE a.bot_key IS NOT NULL
       ),
       counts AS (
         SELECT
           date_trunc('day', e.occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
           e.bot_key,
           COUNT(DISTINCT e.chat_id)::int AS count
         FROM activity_events e
         WHERE e.occurred_at >= (SELECT from_ts FROM params)
           AND e.occurred_at < (SELECT to_ts FROM params)
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

  router.get('/admin/metrics/notifications-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
       automated_counts AS (
         SELECT
           date_trunc('day', std.sent_at AT TIME ZONE 'UTC')::date AS day_utc,
           std.bot_key,
           std.task_type AS notification_type,
           COUNT(*)::int AS count
         FROM scheduled_task_dispatches std
         JOIN filtered_users u ON u.chat_id = std.chat_id
         WHERE std.status = 'sent'
           AND std.sent_at IS NOT NULL
           AND std.sent_at >= (SELECT from_ts FROM params)
           AND std.sent_at < (SELECT to_ts FROM params)
           AND std.task_type = ANY($5::text[])
         GROUP BY 1, 2, 3
       ),
       broadcast_counts AS (
         SELECT
           date_trunc('day', r.sent_at AT TIME ZONE 'UTC')::date AS day_utc,
           r.bot_key,
           ('broadcast_' || c.message_kind)::text AS notification_type,
           COUNT(*)::int AS count
         FROM broadcast_recipients r
         JOIN broadcast_campaigns c
           ON c.id = r.campaign_id
         JOIN filtered_users u
           ON u.chat_id = r.chat_id
         WHERE r.status = 'sent'
           AND r.sent_at IS NOT NULL
           AND r.sent_at >= (SELECT from_ts FROM params)
           AND r.sent_at < (SELECT to_ts FROM params)
         GROUP BY 1, 2, 3
       ),
       aggregated AS (
         SELECT
           combined.day_utc,
           combined.bot_key,
           combined.notification_type,
           SUM(combined.count)::int AS count
         FROM (
           SELECT * FROM automated_counts
           UNION ALL
           SELECT * FROM broadcast_counts
         ) combined
         GROUP BY 1, 2, 3
       ),
       bots AS (
         SELECT DISTINCT bot_key
         FROM aggregated
       ),
       types AS (
         SELECT UNNEST($6::text[]) AS notification_type
       )
       SELECT
         d.day_utc::text AS day,
         b.bot_key,
         t.notification_type,
         COALESCE(a.count, 0)::int AS count
       FROM days d
       CROSS JOIN bots b
       CROSS JOIN types t
       LEFT JOIN aggregated a
         ON a.day_utc = d.day_utc
        AND a.bot_key = b.bot_key
        AND a.notification_type = t.notification_type
       ORDER BY
         d.day_utc ASC,
         b.bot_key ASC,
         array_position($6::text[], t.notification_type) ASC`,
      [
        range.from.toISOString(),
        range.to.toISOString(),
        range.payload,
        excludeChatIds,
        NOTIFICATION_TASK_TYPES,
        NOTIFICATION_SERIES_TYPES
      ]
    );

    return res.json({
      tz: 'UTC',
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      payload: range.payload,
      series: rows
    });
  });

  router.get('/admin/metrics/inactive-users-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/usage-seconds-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/free-users-insights', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const botKey = normalizeBotKey(req.query?.bot_key);
    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const params = [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, botKey];

    const [totalsRes, usageBucketsRes, messageBucketsRes] = await Promise.all([
      ctx.pool.query(
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
                 AND ($5::text IS NULL OR ub.bot_key = $5)
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
            AND ($5::text IS NULL OR v.bot_key = $5)
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
            AND ($5::text IS NULL OR m.bot_key = $5)
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
      ctx.pool.query(
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
                 AND ($5::text IS NULL OR ub.bot_key = $5)
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
            AND ($5::text IS NULL OR v.bot_key = $5)
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
      ctx.pool.query(
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
                 AND ($5::text IS NULL OR ub.bot_key = $5)
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
            AND ($5::text IS NULL OR m.bot_key = $5)
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
      bot_key: botKey,
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

  router.get('/admin/metrics/active-users-by-hour', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
       activity_events AS (
         SELECT
           v.chat_id,
           v.occurred_at
         FROM voice_usage_events v
         JOIN filtered_users u ON u.chat_id = v.chat_id

         UNION

         SELECT
           m.chat_id,
           m.created_at AS occurred_at
         FROM messages m
         JOIN filtered_users u ON u.chat_id = m.chat_id
         WHERE m.role = 'user'

         UNION

         SELECT
           a.chat_id,
           a.occurred_at
         FROM action_events a
         JOIN filtered_users u ON u.chat_id = a.chat_id
       ),
       counts AS (
         SELECT
           EXTRACT(HOUR FROM e.occurred_at AT TIME ZONE 'UTC')::int AS hour_utc,
           COUNT(DISTINCT e.chat_id)::int AS count
         FROM activity_events e
         WHERE e.occurred_at >= (SELECT from_ts FROM params)
           AND e.occurred_at < (SELECT to_ts FROM params)
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

  router.get('/admin/metrics/active-users-by-hour-today', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const to = new Date(from.getTime() + DAY_MS);
    const payloadRaw = (req.query.payload ?? '').toString().trim();
    const payload = payloadRaw ? payloadRaw.slice(0, 200) : null;
    const excludeChatIds = helpers.parseAdminRange({ query: { from: from.toISOString(), to: to.toISOString(), payload, exclude_chat_ids: req.query.exclude_chat_ids ?? req.query.excludeChatIds } }).excludeChatIds || [];
    const excludeChatIdsParam = excludeChatIds.length ? excludeChatIds : null;

    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/bot-stats', requireAdmin, async (_req, res) => {
    res.set('Cache-Control', 'no-store');

    const { rows } = await ctx.pool.query(
      `SELECT * FROM bot_stats ORDER BY bot_key`
    );
    const automatedMessageTestState = getAutomatedMessageTestState();

    return res.json({
      bots: rows || [],
      automated_message_test_mode_active: automatedMessageTestState.active,
      automated_message_test_chat_ids: automatedMessageTestState.chatIds,
      automated_message_test_chat_ids_count: automatedMessageTestState.chatIds.length
    });
  });

  router.get('/admin/metrics/acquisition-payloads', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/actions-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'onboarding_scenario_selected'), 0)::int AS onboarding_scenario_selected,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'onboarding_practice_sent'), 0)::int AS onboarding_practice_sent,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'onboarding_completed'), 0)::int AS onboarding_completed,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'onboarding_level_confirmed'), 0)::int AS onboarding_level_confirmed,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'onboarding_bonus_selected'), 0)::int AS onboarding_bonus_selected,
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

  router.get('/admin/metrics/action-totals', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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

  router.get('/admin/metrics/reply-keyboard-clicks-by-day', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
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
           COUNT(*)::int AS count
         FROM action_events e
         JOIN filtered_users u ON u.chat_id = e.chat_id
         WHERE e.occurred_at >= (SELECT from_ts FROM params)
           AND e.occurred_at < (SELECT to_ts FROM params)
           AND e.action_type = ANY($5::text[])
         GROUP BY 1, 2
       )
       SELECT
         d.day_utc::text AS day,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'reply_kbd_level_click'), 0)::int AS reply_kbd_level_click,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'reply_kbd_voice_click'), 0)::int AS reply_kbd_voice_click,
         COALESCE(SUM(c.count) FILTER (WHERE c.action_type = 'idiom_phrase_more_click'), 0)::int AS idiom_phrase_more_click
       FROM days d
       LEFT JOIN counts c USING (day_utc)
       GROUP BY d.day_utc
       ORDER BY d.day_utc ASC`,
      [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, REPLY_KEYBOARD_ACTION_TYPES]
    );

    return res.json({
      tz: 'UTC',
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      payload: range.payload,
      series: rows
    });
  });

  router.get('/admin/metrics/reply-keyboard-click-totals', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const { rows } = await ctx.pool.query(
      `WITH filtered_users AS (
         SELECT chat_id
         FROM users
         WHERE ($3::text IS NULL OR acquisition_start_payload = $3)
           AND ($4::bigint[] IS NULL OR chat_id <> ALL($4::bigint[]))
       ),
       filtered_events AS (
         SELECT e.chat_id, e.action_type
         FROM action_events e
         JOIN filtered_users u ON u.chat_id = e.chat_id
         WHERE e.occurred_at >= $1::timestamptz
           AND e.occurred_at < $2::timestamptz
           AND e.action_type = ANY($5::text[])
       ),
       summary AS (
         SELECT
           COUNT(*)::int AS total_clicks,
           COUNT(DISTINCT chat_id)::int AS unique_users
         FROM filtered_events
       ),
       action_types AS (
         SELECT unnest($5::text[]) AS action_type
       ),
       counts AS (
         SELECT
           action_type,
           COUNT(*)::int AS clicks,
           COUNT(DISTINCT chat_id)::int AS unique_users
         FROM filtered_events
         GROUP BY action_type
       )
       SELECT
         a.action_type AS action,
         COALESCE(c.clicks, 0)::int AS clicks,
         COALESCE(c.unique_users, 0)::int AS unique_users,
         COALESCE(s.total_clicks, 0)::int AS total_clicks,
         COALESCE(s.unique_users, 0)::int AS summary_unique_users
       FROM action_types a
       CROSS JOIN summary s
       LEFT JOIN counts c ON c.action_type = a.action_type
       ORDER BY array_position($5::text[], a.action_type) ASC`,
      [range.from.toISOString(), range.to.toISOString(), range.payload, excludeChatIds, REPLY_KEYBOARD_ACTION_TYPES]
    );

    const summary = rows[0]
      ? {
          total_clicks: Number(rows[0].total_clicks || 0),
          unique_users: Number(rows[0].summary_unique_users || 0)
        }
      : {
          total_clicks: 0,
          unique_users: 0
        };

    return res.json({
      tz: 'UTC',
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      payload: range.payload,
      summary,
      series: rows.map((row) => ({
        action: row.action,
        clicks: Number(row.clicks || 0),
        unique_users: Number(row.unique_users || 0)
      }))
    });
  });

  router.get('/admin/metrics/action-funnel', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const excludeChatIds = range.excludeChatIds?.length ? range.excludeChatIds : null;
    const funnelActionTypes = [
      'onboarding_scenario_selected',
      'onboarding_practice_sent',
      'free_limit_half',
      'paywall_shown'
    ];

    const { rows } = await ctx.pool.query(
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
       per_user AS (
         SELECT
           c.chat_id,
           c.start_at,
           MIN(e.occurred_at) FILTER (WHERE e.action_type = 'onboarding_scenario_selected') AS scenario_selected_at,
           MIN(e.occurred_at) FILTER (WHERE e.action_type = 'onboarding_practice_sent') AS practice_sent_at,
           onboarding.onboarding_complete_at,
           MIN(e.occurred_at) FILTER (WHERE e.action_type = 'free_limit_half') AS free_limit_half_at,
           MIN(e.occurred_at) FILTER (WHERE e.action_type = 'paywall_shown') AS paywall_shown_at
         FROM cohort c
         LEFT JOIN action_events e
           ON e.chat_id = c.chat_id
          AND e.action_type = ANY($5::text[])
          AND e.occurred_at >= c.start_at
          AND e.occurred_at < $2::timestamptz
         LEFT JOIN LATERAL (
           SELECT MIN(completion.completed_at) AS onboarding_complete_at
           FROM bot_onboarding_completion completion
           WHERE completion.chat_id = c.chat_id
             AND completion.completed_at >= c.start_at
             AND completion.completed_at < $2::timestamptz
         ) onboarding ON true
         GROUP BY c.chat_id, c.start_at, onboarding.onboarding_complete_at
       ),
       counts AS (
         SELECT
           COUNT(*)::int AS start_count,
           SUM(
             CASE
               WHEN scenario_selected_at IS NOT NULL
                 THEN 1
               ELSE 0
             END
           )::int AS scenario_selected_count,
           SUM(
             CASE
               WHEN practice_sent_at IS NOT NULL
                 THEN 1
               ELSE 0
             END
           )::int AS practice_sent_count,
           SUM(
             CASE
               WHEN practice_sent_at IS NOT NULL
                AND onboarding_complete_at IS NOT NULL
                AND onboarding_complete_at >= practice_sent_at
                 THEN 1
               ELSE 0
             END
           )::int AS onboarding_complete_count,
           SUM(
             CASE
               WHEN practice_sent_at IS NOT NULL
                AND onboarding_complete_at IS NOT NULL
                AND onboarding_complete_at >= practice_sent_at
                AND free_limit_half_at IS NOT NULL
                AND free_limit_half_at >= onboarding_complete_at
                 THEN 1
               ELSE 0
             END
           )::int AS free_limit_half_count,
           SUM(
             CASE
               WHEN practice_sent_at IS NOT NULL
                AND onboarding_complete_at IS NOT NULL
                AND onboarding_complete_at >= practice_sent_at
                AND free_limit_half_at IS NOT NULL
                AND free_limit_half_at >= onboarding_complete_at
                AND paywall_shown_at IS NOT NULL
                AND paywall_shown_at >= free_limit_half_at
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
    const scenarioSelectedCount = Number(row.scenario_selected_count || 0);
    const practiceSentCount = Number(row.practice_sent_count || 0);
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
        { action: 'scenario_selected', count: scenarioSelectedCount, pct: pct(scenarioSelectedCount) },
        { action: 'practice_sent', count: practiceSentCount, pct: pct(practiceSentCount) },
        { action: 'onboarding_complete', count: onboardingCompleteCount, pct: pct(onboardingCompleteCount) },
        { action: 'free_limit_half', count: freeLimitHalfCount, pct: pct(freeLimitHalfCount) },
        { action: 'paywall_shown', count: paywallShownCount, pct: pct(paywallShownCount) }
      ]
    });
  });

  router.get('/admin/stripe/product-prices', requireAdmin, async (_req, res) => {
    try {
      const productId = helpers.getStripeBillingProductId();
      const snapshot = await helpers.loadAdminBillingSnapshot(productId);
      return res.json(snapshot);
    } catch (err) {
      console.error('Admin Stripe product prices list failed', err);
      captureException(err, { tags: { route: 'admin-stripe-product-prices-list' } });
      return billingRouteErrorResponse(res, err, 500);
    }
  });

  router.post('/admin/stripe/product-prices', requireAdmin, async (req, res) => {
    const currency = normalizeCurrencyCode(req.body?.currency);
    const monthlyAmountCents = helpers.parsePositiveInteger(req.body?.monthly_amount_cents);
    const annualAmountCents = helpers.parsePositiveInteger(req.body?.annual_amount_cents);

    if (!currency) {
      return res.status(400).json({ error: 'bad_currency' });
    }
    if (monthlyAmountCents === null) {
      return res.status(400).json({ error: 'bad_monthly_amount_cents' });
    }
    if (annualAmountCents === null) {
      return res.status(400).json({ error: 'bad_annual_amount_cents' });
    }

    let client;
    const createdPriceIds = [];
    try {
      const productId = helpers.getStripeBillingProductId();
      const runtimeCurrency = normalizeRuntimeCurrencyCode(currency);

      client = await ctx.pool.connect();
      await client.query('BEGIN');

      const { rows: existingRows } = await client.query(
        `SELECT id, stripe_price_id, billing_interval
           FROM plan_prices
          WHERE tier = 'pro'
            AND currency = $1
            AND billing_interval = ANY($2::text[])`,
        [runtimeCurrency, ['month', 'year']]
      );

      if (existingRows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'runtime_price_exists',
          detail: 'Runtime prices already exist for this currency.',
          existing: existingRows.map((row) => ({
            currency,
            billing_interval: row.billing_interval,
            stripe_price_id: row.stripe_price_id || null
          }))
        });
      }

      const monthlyPrice = await ctx.stripe.prices.create({
        product: productId,
        currency,
        unit_amount: monthlyAmountCents,
        recurring: { interval: 'month' }
      });
      createdPriceIds.push(monthlyPrice.id);

      const annualPrice = await ctx.stripe.prices.create({
        product: productId,
        currency,
        unit_amount: annualAmountCents,
        recurring: { interval: 'year' }
      });
      createdPriceIds.push(annualPrice.id);

      await client.query(
        `INSERT INTO plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
         VALUES
           ('pro', $1, $2, 'month', $3, true),
           ('pro', $1, $4, 'year', $5, true)`,
        [runtimeCurrency, monthlyAmountCents, monthlyPrice.id, annualAmountCents, annualPrice.id]
      );

      await client.query('COMMIT');

      return res.json({
        product_id: productId,
        prices: {
          month: helpers.summarizeBillingEntry({
            currency,
            billing_interval: 'month',
            stripe_price_id: monthlyPrice.id,
            amount_cents: monthlyAmountCents
          }),
          year: helpers.summarizeBillingEntry({
            currency,
            billing_interval: 'year',
            stripe_price_id: annualPrice.id,
            amount_cents: annualAmountCents
          })
        }
      });
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Admin Stripe product price create rollback failed', rollbackErr);
          captureException(rollbackErr, { tags: { route: 'admin-stripe-product-prices-create-rollback' } });
        }
      }
      await Promise.all(createdPriceIds.map((priceId) => helpers.archiveStripePriceSafely(priceId)));
      console.error('Admin Stripe product price create failed', err);
      captureException(err, {
        tags: { route: 'admin-stripe-product-prices-create' },
        extra: { currency }
      });
      if (err?.code === '23505') {
        return res.status(409).json({
          error: 'runtime_price_exists',
          detail: 'Runtime prices already exist for this currency.'
        });
      }
      return billingRouteErrorResponse(res, err, 500);
    } finally {
      client?.release();
    }
  });

  router.post('/admin/stripe/product-prices/:id/replace', requireAdmin, async (req, res) => {
    const priceId = String(req.params.id || '').trim();
    const amountCents = helpers.parsePositiveInteger(req.body?.amount_cents);

    if (!priceId) {
      return res.status(400).json({ error: 'bad_price_id' });
    }
    if (amountCents === null) {
      return res.status(400).json({ error: 'bad_amount_cents' });
    }

    try {
      const productId = helpers.getStripeBillingProductId();
      const { normalized } = await helpers.getManagedStripePrice(priceId, productId);
      const runtimeCurrency = normalizeRuntimeCurrencyCode(normalized.currency);
      const { rows: runtimeRows } = await ctx.pool.query(
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

      const replacement = await ctx.stripe.prices.create({
        product: productId,
        currency: normalized.currency,
        unit_amount: amountCents,
        recurring: { interval: normalized.billing_interval }
      });

      await ctx.stripe.prices.update(priceId, { active: false });

      await ctx.pool.query(
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
        price: helpers.summarizeBillingEntry({
          currency: normalized.currency,
          billing_interval: normalized.billing_interval,
          stripe_price_id: replacement.id,
          amount_cents: amountCents
        })
      });
    } catch (err) {
      console.error('Admin Stripe product price replace failed', err);
      captureException(err, {
        tags: { route: 'admin-stripe-product-prices-replace' },
        extra: { priceId }
      });
      return billingRouteErrorResponse(res, err, 500);
    }
  });

  router.post('/admin/stripe/product-prices/:id/archive', requireAdmin, async (req, res) => {
    const priceId = String(req.params.id || '').trim();
    if (!priceId) {
      return res.status(400).json({ error: 'bad_price_id' });
    }

    try {
      const productId = helpers.getStripeBillingProductId();
      const { normalized } = await helpers.getManagedStripePrice(priceId, productId);

      await ctx.stripe.prices.update(priceId, { active: false });

      const result = await ctx.pool.query(
        `DELETE FROM plan_prices
          WHERE tier = 'pro'
            AND stripe_price_id = $1`,
        [priceId]
      );

      return res.json({
        product_id: productId,
        archived_price_id: priceId,
        removed_runtime: result.rowCount > 0,
        price: helpers.summarizeBillingEntry({
          currency: normalized.currency,
          billing_interval: normalized.billing_interval,
          stripe_price_id: priceId,
          amount_cents: normalized.amount_cents
        })
      });
    } catch (err) {
      console.error('Admin Stripe product price archive failed', err);
      captureException(err, {
        tags: { route: 'admin-stripe-product-prices-archive' },
        extra: { priceId }
      });
      return billingRouteErrorResponse(res, err, 500);
    }
  });

  router.post('/admin/stripe/product-prices/sync', requireAdmin, async (_req, res) => {
    let client;
    try {
      const productId = helpers.getStripeBillingProductId();
      const stripePricesRaw = await helpers.listStripeBillingProductPrices(productId);
      const activeStripePrices = stripePricesRaw.filter((price) => {
        if (!price?.active) return false;
        if (price?.type !== 'recurring') return false;
        return Boolean(helpers.buildBillingPriceKey(price.currency, price.recurring?.interval));
      });

      const activeByKey = new Map();
      const conflicts = [];

      for (const price of activeStripePrices) {
        const key = helpers.buildBillingPriceKey(price.currency, price.recurring?.interval);
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

      client = await ctx.pool.connect();
      await client.query('BEGIN');

      const runtimeRows = await helpers.loadRuntimePlanPrices(client);
      const runtimeByKey = new Map();
      for (const row of runtimeRows) {
        const key = helpers.buildBillingPriceKey(row.currency, row.billing_interval);
        if (key) runtimeByKey.set(key, row);
      }

      const created = [];
      const updated = [];
      const removed = [];
      const unchanged = [];

      for (const prices of activeByKey.values()) {
        const price = prices[0];
        const normalized = helpers.assertManagedStripePrice(price, productId);
        const key = helpers.buildBillingPriceKey(normalized.currency, normalized.billing_interval);
        if (!key) continue;

        const runtimeCurrency = normalizeRuntimeCurrencyCode(normalized.currency);
        const existing = runtimeByKey.get(key) || null;

        if (!existing) {
          await client.query(
            `INSERT INTO plan_prices (tier, currency, amount_cents, billing_interval, stripe_price_id, active)
             VALUES ('pro', $1, $2, $3, $4, true)`,
            [runtimeCurrency, normalized.amount_cents, normalized.billing_interval, price.id]
          );
          created.push(helpers.summarizeBillingEntry({
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
          unchanged.push(helpers.summarizeBillingEntry({
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

        updated.push(helpers.summarizeBillingEntry({
          currency: normalized.currency,
          billing_interval: normalized.billing_interval,
          stripe_price_id: price.id,
          amount_cents: normalized.amount_cents
        }));
      }

      const activeKeys = new Set(activeByKey.keys());
      for (const row of runtimeRows) {
        const key = helpers.buildBillingPriceKey(row.currency, row.billing_interval);
        if (key && activeKeys.has(key)) continue;

        await client.query(`DELETE FROM plan_prices WHERE id = $1`, [row.id]);
        removed.push(helpers.summarizeBillingEntry({
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
          captureException(rollbackErr, { tags: { route: 'admin-stripe-product-prices-sync-rollback' } });
        }
      }
      console.error('Admin Stripe product price sync failed', err);
      captureException(err, { tags: { route: 'admin-stripe-product-prices-sync' } });
      return billingRouteErrorResponse(res, err, 500);
    } finally {
      client?.release();
    }
  });

  router.get('/admin/feedbacks', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const kindRaw = (req.query.kind ?? '').toString().trim().toLowerCase();
    const kind = ['text', 'voice'].includes(kindRaw) ? kindRaw : null;
    const statusRaw = (req.query.status ?? '').toString().trim().toLowerCase();
    const status = ['active', 'archived'].includes(statusRaw) ? statusRaw : null;
    const searchRaw = (req.query.search ?? '').toString().trim();
    const search = searchRaw ? searchRaw.slice(0, 120) : null;
    const limit = helpers.clampInteger(req.query.limit, { min: 1, max: 200, fallback: 50 });
    const offset = helpers.clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

    const baseParams = [range.from.toISOString(), range.to.toISOString(), kind, search, status];
    const [totalRes, threadsRes] = await Promise.all([
      ctx.pool.query(
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
      ctx.pool.query(
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
      const messagesRes = await ctx.pool.query(
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

  router.post('/admin/feedbacks/thread/archive', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const target = helpers.parseAdminFeedbackThreadTarget(req.body || {});
    if (!target.ok) return res.status(400).json({ error: target.error });

    const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
    const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';

    await ctx.pool.query(
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

  router.post('/admin/feedbacks/thread/unarchive', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const target = helpers.parseAdminFeedbackThreadTarget(req.body || {});
    if (!target.ok) return res.status(400).json({ error: target.error });

    await ctx.pool.query(
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

  router.post('/admin/feedbacks/thread/delete', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const target = helpers.parseAdminFeedbackThreadTarget(req.body || {});
    if (!target.ok) return res.status(400).json({ error: target.error });

    let replyDeleted = 0;
    let feedbackDeleted = 0;
    let metaDeleted = 0;

    await ctx.pool.query('BEGIN');
    try {
      const repliesRes = await ctx.pool.query(
        `DELETE FROM feedback_replies
         WHERE chat_id = $1::bigint
           AND bot_key = $2::text`,
        [target.chatId, target.botKey]
      );
      replyDeleted = repliesRes.rowCount || 0;

      const feedbackRes = await ctx.pool.query(
        `DELETE FROM feedback
         WHERE chat_id = $1::bigint
           AND bot_key = $2::text`,
        [target.chatId, target.botKey]
      );
      feedbackDeleted = feedbackRes.rowCount || 0;

      const metaRes = await ctx.pool.query(
        `DELETE FROM feedback_threads
         WHERE chat_id = $1::bigint
           AND bot_key = $2::text`,
        [target.chatId, target.botKey]
      );
      metaDeleted = metaRes.rowCount || 0;

      await ctx.pool.query('COMMIT');
    } catch (err) {
      await ctx.pool.query('ROLLBACK');
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

  router.post('/admin/feedbacks/:id/reply', requireAdmin, async (req, res) => {
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
    if (messageText.length > helpers.BROADCAST_MESSAGE_MAX_LEN) {
      return res.status(400).json({
        error: 'message_too_long',
        max_length: helpers.BROADCAST_MESSAGE_MAX_LEN
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

    const { rows } = await ctx.pool.query(
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
    const botKey = normalizeBotKey(feedback.bot_key) || await helpers.resolveUserBotKey(chatId) || null;
    let replyTarget = feedback;

    if (Number.isFinite(replyToFeedbackId) && replyToFeedbackId > 0 && replyToFeedbackId !== feedbackId) {
      const { rows: replyTargetRows } = await ctx.pool.query(
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
      const telegramResult = await helpers.sendTelegramTextMessage(chatId, messageText, {
        botKey,
        replyToMessageId
      });
      const messageIdRaw = Number(telegramResult?.message_id ?? 0);
      const telegramMessageId = Number.isFinite(messageIdRaw) && messageIdRaw > 0 ? messageIdRaw : null;
      const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
      const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';

      const { rows: replyRows } = await ctx.pool.query(
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

      await ctx.pool.query(
        `DELETE FROM feedback_threads
         WHERE chat_id = $1::bigint
           AND bot_key = $2::text`,
        [chatId, botKey || 'uk-de']
      );

      await helpers.updateUserDeliveryState(chatId, {
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
      const detail = helpers.sanitizeErrorText(err?.message || String(err)) || 'telegram_send_failed';
      const inactiveReason = helpers.classifyPermanentTelegramFailure(err);

      await helpers.updateUserDeliveryState(chatId, {
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

  router.get('/admin/users/search', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const raw = (req.query.q ?? '').toString().trim();
    const q = raw.replace(/^@/, '').slice(0, 80);
    const limit = helpers.clampInteger(req.query.limit, { min: 1, max: 50, fallback: 10 });

    if (!q) {
      return res.json({ q: '', items: [] });
    }

    const chatId = /^\d{4,20}$/.test(q) ? q : null;

    const { rows } = await ctx.pool.query(
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

  router.post('/admin/reminders/test-send', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const chatId = Number(req.body?.chatId ?? req.body?.chat_id);
    const botKey = normalizeBotKey(req.body?.botKey ?? req.body?.bot_key);
    const reminderType = String(req.body?.reminderType ?? req.body?.reminder_type ?? '').trim().toLowerCase();
    const isDay1ReturnType = reminderType === 'day1_return';
    const isWeeklyDigestType = reminderType === 'weekly_digest';
    const isIdiomPracticeType = reminderType === 'idiom_phrase_practice';
    const isWinbackType = ['d3', 'd7', 'd14'].includes(reminderType);
    const isFreeLimitHalfType = reminderType === 'free_limit_50';

    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || (!isDay1ReturnType && !isWeeklyDigestType && !isIdiomPracticeType && !isWinbackType && !isFreeLimitHalfType)) {
      return res.status(400).json({ error: 'bad_request' });
    }

    try {
      const result = isDay1ReturnType
        ? await sendAdminTestDay1ReturnReminder({
            chatId,
            botKey
          })
        : isWeeklyDigestType
          ? await sendAdminTestWeeklyDigestReminder({
            chatId,
            botKey
          })
        : isIdiomPracticeType
          ? await sendAdminTestIdiomPracticeReminder({
              chatId,
              botKey
            })
        : isFreeLimitHalfType
          ? await sendAdminTestFreeLimitHalfReminder({
              chatId,
              botKey
            })
          : await sendAdminTestWinbackReminder({
            chatId,
            botKey,
            reminderType
          });
      return res.json(result);
    } catch (err) {
      const errorCode = String(err?.code || '').trim() || 'request_failed';
      const detail = String(err?.detail || err?.message || errorCode).trim() || errorCode;

      if (errorCode === 'user_bot_not_found') {
        return res.status(404).json({ error: 'user_bot_not_found' });
      }
      if (errorCode === 'chat_not_allowed_in_test_mode') {
        return res.status(403).json({ error: 'chat_not_allowed_in_test_mode' });
      }
      if (
        errorCode === 'missing_free_limit_half_message'
        || errorCode === 'missing_free_limit_half_cta'
        || errorCode === 'free_limit_half_send_failed'
        || errorCode === 'insufficient_phrase_catalog'
        || errorCode === 'missing_phrase_translation'
        || errorCode === 'idiom_phrase_send_failed'
        || errorCode === 'idiom_phrase_build_failed'
        || errorCode === 'weekly_digest_build_failed'
        || errorCode === 'weekly_digest_send_failed'
      ) {
        return res.status(502).json({ error: errorCode, detail });
      }
      if (errorCode === 'llm_generation_failed') {
        return res.status(502).json({ error: 'llm_generation_failed', detail });
      }
      if (errorCode === 'telegram_send_failed') {
        return res.status(502).json({
          error: 'telegram_send_failed',
          detail,
          inactive_reason: err?.inactiveReason || null
        });
      }
      if (errorCode === 'bad_request' || errorCode === 'bad_reminder_type') {
        return res.status(400).json({ error: 'bad_request' });
      }

      console.error('Admin reminder test send failed', err);
      captureException(err, { tags: { route: 'admin-reminder-test-send' } });
      return res.status(502).json({ error: 'request_failed', detail });
    }
  });

  router.put('/admin/users/:chatId/plan-override', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const chatId = parsePositiveBigintParam(req.params.chatId);
    if (!chatId) return res.status(400).json({ error: 'bad_chat_id' });

    const tier = String(req.body?.tier ?? '').trim().toLowerCase();
    if (tier !== 'pro') return res.status(400).json({ error: 'bad_tier' });

    const expiry = parseInclusiveUtcExpiry(req.body?.expires_on ?? req.body?.expiresOn);
    if (!expiry.ok) return res.status(400).json({ error: expiry.error });

    const { rows } = await ctx.pool.query(
      `WITH updated AS (
         UPDATE users
         SET override_plan_tier = 'pro',
             override_expires_at = $2::timestamptz,
             updated_at = NOW()
         WHERE chat_id = $1::bigint
         RETURNING
           chat_id,
           plan_tier,
           plan_expires_at,
           override_plan_tier,
           override_expires_at
       )
       SELECT
         chat_id,
         override_plan_tier,
         override_expires_at,
         (($2::timestamptz AT TIME ZONE 'UTC') - interval '1 day')::date::text AS override_expires_on,
         CASE
           WHEN override_plan_tier IS NOT NULL
             AND override_expires_at IS NOT NULL
             AND NOW() < override_expires_at
             THEN override_plan_tier
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN plan_tier
           ELSE 'free'
         END AS effective_tier,
         CASE
           WHEN override_plan_tier IS NOT NULL
             AND override_expires_at IS NOT NULL
             AND NOW() < override_expires_at
             THEN 'manual'
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN 'subscription'
           ELSE 'free'
         END AS tier_source
       FROM updated`,
      [chatId, expiry.expiresAt.toISOString()]
    );

    if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ ok: true, ...rows[0] });
  });

  router.delete('/admin/users/:chatId/plan-override', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const chatId = parsePositiveBigintParam(req.params.chatId);
    if (!chatId) return res.status(400).json({ error: 'bad_chat_id' });

    const { rows } = await ctx.pool.query(
      `WITH updated AS (
         UPDATE users
         SET override_plan_tier = NULL,
             override_expires_at = NULL,
             updated_at = NOW()
         WHERE chat_id = $1::bigint
         RETURNING
           chat_id,
           plan_tier,
           plan_expires_at
       )
       SELECT
         chat_id,
         NULL::text AS override_plan_tier,
         NULL::timestamptz AS override_expires_at,
         NULL::text AS override_expires_on,
         CASE
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN plan_tier
           ELSE 'free'
         END AS effective_tier,
         CASE
           WHEN plan_expires_at IS NOT NULL AND NOW() < plan_expires_at
             THEN 'subscription'
           ELSE 'free'
         END AS tier_source
       FROM updated`,
      [chatId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ ok: true, ...rows[0] });
  });

  router.post('/admin/users/delete', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const target = helpers.parseAdminChatIdTarget(req.body || {});
    if (!target.ok) return res.status(400).json({ error: target.error });

    const client = await ctx.pool.connect();
    const deleted = {};
    try {
      await client.query('BEGIN');

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
      await deleteTableByChatId('llm_call_events');
      await deleteTableByChatId('loader_flags');
      await deleteTableByChatId('messages');
      await deleteTableByChatId('payments');
      await deleteTableByChatId('pending_feedback');
      await deleteTableByChatId('usage_hourly');
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

  router.get('/admin/users', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    res.set('Cache-Control', 'no-store');

    const hasCreatedRange = Boolean(
      String(req.query.from ?? '').trim() || String(req.query.to ?? '').trim()
    );
    const createdFrom = hasCreatedRange ? range.from : null;
    const createdTo = hasCreatedRange ? range.to : null;

    const limit = helpers.clampInteger(req.query.limit, { min: 1, max: 500, fallback: 50 });
    const offset = helpers.clampInteger(req.query.offset, { min: 0, max: 100000, fallback: 0 });

    const rawSearch = String(req.query.q ?? '').trim();
    const search = rawSearch.replace(/^@/, '').slice(0, 80) || null;

    const rawBotKey = String(req.query.bot_key ?? '').trim();
    const botKey = rawBotKey ? normalizeBotKey(rawBotKey) : null;
    if (rawBotKey && (!botKey || !helpers.publicBotMetaForKey(botKey))) {
      return res.status(400).json({ error: 'bad_bot_key' });
    }

    const rawTier = String(req.query.tier ?? '').trim().toLowerCase();
    const tier = rawTier && rawTier !== 'all' ? rawTier : null;
    if (tier && !['free', 'pro'].includes(tier)) {
      return res.status(400).json({ error: 'bad_tier' });
    }

    const rawActive = String(req.query.active ?? '').trim().toLowerCase();
    let active = null;
    if (rawActive && rawActive !== 'all') {
      if (!['true', 'false'].includes(rawActive)) {
        return res.status(400).json({ error: 'bad_active' });
      }
      active = rawActive === 'true';
    }

    const lastSeenRange = parseOptionalInclusiveUtcRange(
      req.query.last_seen_from,
      req.query.last_seen_to,
      { dateError: 'bad_last_seen_date', rangeError: 'bad_last_seen_range' }
    );
    if (!lastSeenRange.ok) return res.status(400).json({ error: lastSeenRange.error });

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
      'streak_days'
    ]);
    const sortKey = sortKeyAllow.has(sortKeyRaw) ? sortKeyRaw : 'created_at';

    const orderByMap = {
      created_at: `d.created_at`,
      chat_id: `d.chat_id`,
      username: `LOWER(d.username)`,
      first_name: `LOWER(d.first_name)`,
      bot_key: `d.bot_key`,
      effective_tier: `effective_tier`,
      is_active: `is_active`,
      last_seen_at: `last_seen_at`,
      streak_days: `COALESCE(ms.streak_days, 0)`
    };
    const orderExpr = orderByMap[sortKey] || orderByMap.created_at;

    const params = [
      createdFrom?.toISOString() || null,
      createdTo?.toISOString() || null,
      range.payload,
      search,
      botKey,
      tier,
      active,
      lastSeenRange.from?.toISOString() || null,
      lastSeenRange.toExclusive?.toISOString() || null,
      limit,
      offset
    ];
    const directoryCte = `WITH directory_users AS (
       SELECT
         u.chat_id,
         u.username,
         u.first_name,
         u.created_at,
         u.updated_at,
         u.plan_tier,
         u.plan_expires_at,
         u.override_plan_tier,
         u.override_expires_at,
         bot_context.bot_key,
         bot_context.last_seen_at,
         CASE
           WHEN $5::text IS NOT NULL THEN COALESCE(bot_context.is_active, false)
           ELSE COALESCE(all_bot_activity.is_active, false)
         END AS is_active,
         CASE
           WHEN u.override_plan_tier IS NOT NULL
             AND u.override_expires_at IS NOT NULL
             AND NOW() < u.override_expires_at
             THEN u.override_plan_tier
           WHEN u.plan_expires_at IS NOT NULL AND NOW() < u.plan_expires_at
             THEN u.plan_tier
           ELSE 'free'
         END AS effective_tier,
         CASE
           WHEN u.override_plan_tier IS NOT NULL
             AND u.override_expires_at IS NOT NULL
             AND NOW() < u.override_expires_at
             THEN 'manual'
           WHEN u.plan_expires_at IS NOT NULL AND NOW() < u.plan_expires_at
             THEN 'subscription'
           ELSE 'free'
         END AS tier_source
       FROM users u
       LEFT JOIN LATERAL (
         SELECT
           b.bot_key,
           b.last_seen_at,
           COALESCE(b.is_active, true) AS is_active
         FROM user_bots b
         WHERE b.chat_id = u.chat_id
           AND ($5::text IS NULL OR b.bot_key = $5::text)
         ORDER BY COALESCE(b.last_seen_at, b.updated_at, b.created_at) DESC, b.bot_key ASC
         LIMIT 1
       ) bot_context ON true
       LEFT JOIN LATERAL (
         SELECT BOOL_OR(COALESCE(b.is_active, true)) AS is_active
         FROM user_bots b
         WHERE b.chat_id = u.chat_id
       ) all_bot_activity ON true
       WHERE ($1::timestamptz IS NULL OR u.created_at >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR u.created_at < $2::timestamptz)
         AND ($3::text IS NULL OR u.acquisition_start_payload = $3::text)
         AND (
           $4::text IS NULL
           OR u.username ILIKE ('%' || $4::text || '%')
           OR u.first_name ILIKE ('%' || $4::text || '%')
           OR u.chat_id::text LIKE ('%' || $4::text || '%')
         )
         AND ($5::text IS NULL OR bot_context.bot_key IS NOT NULL)
     ),
     directory_filtered AS (
       SELECT *
       FROM directory_users
       WHERE ($6::text IS NULL OR effective_tier = $6::text)
         AND ($7::boolean IS NULL OR is_active = $7::boolean)
         AND ($8::timestamptz IS NULL OR last_seen_at >= $8::timestamptz)
         AND ($9::timestamptz IS NULL OR last_seen_at < $9::timestamptz)
     )`;
    const [totalRes, rowsRes] = await Promise.all([
      ctx.pool.query(
        `${directoryCte}
         SELECT COUNT(*)::int AS total
         FROM directory_filtered`,
        params.slice(0, 9)
      ),
      ctx.pool.query(
        `${directoryCte},
         activity_days AS (
           SELECT DISTINCT activity.chat_id, activity.day_utc
           FROM (
             SELECT
               v.chat_id,
               date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day_utc
             FROM voice_usage_events v
             WHERE ($1::timestamptz IS NULL OR v.occurred_at >= $1::timestamptz)
               AND ($2::timestamptz IS NULL OR v.occurred_at < $2::timestamptz)

             UNION

             SELECT
               m.chat_id,
               date_trunc('day', m.created_at AT TIME ZONE 'UTC')::date AS day_utc
             FROM messages m
             WHERE m.role = 'user'
               AND ($1::timestamptz IS NULL OR m.created_at >= $1::timestamptz)
               AND ($2::timestamptz IS NULL OR m.created_at < $2::timestamptz)
           ) activity
           JOIN directory_filtered d ON d.chat_id = activity.chat_id
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
           d.chat_id,
           d.username,
           d.first_name,
           d.bot_key,
           d.created_at,
           COALESCE(d.last_seen_at, d.updated_at) AS last_seen_at,
           d.is_active,
           d.effective_tier,
           d.tier_source,
           CASE
             WHEN d.tier_source = 'manual' THEN d.override_expires_at
             ELSE NULL
           END AS override_expires_at,
           CASE
             WHEN d.tier_source = 'manual'
               THEN ((d.override_expires_at AT TIME ZONE 'UTC') - interval '1 day')::date::text
             ELSE NULL
           END AS override_expires_on,
           COALESCE(ms.streak_days, 0) AS streak_days
         FROM directory_filtered d
         LEFT JOIN max_streaks ms ON ms.chat_id = d.chat_id
         ORDER BY ${orderExpr} ${sortDir} NULLS LAST, d.chat_id DESC
         LIMIT $10::int
         OFFSET $11::int`,
        params
      )
    ]);

    return res.json({
      tz: 'UTC',
      from: createdFrom?.toISOString() || null,
      to: createdTo?.toISOString() || null,
      payload: range.payload,
      q: search,
      bot_key: botKey,
      tier,
      active,
      last_seen_from: lastSeenRange.fromValue,
      last_seen_to: lastSeenRange.toValue,
      sort_key: sortKey,
      sort_dir: sortDirRaw === 'asc' ? 'asc' : 'desc',
      limit,
      offset,
      total: totalRes.rows[0]?.total || 0,
      items: rowsRes.rows || []
    });
  });

  router.post('/admin/broadcast-campaigns/preview', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const filters = helpers.normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
    const botSelection = helpers.validateBroadcastBotSelection(filters.bots);
    if (!botSelection.ok) {
      return res.status(400).json({ error: botSelection.error });
    }
    filters.bots = botSelection.botKeys;
    const preview = await helpers.getBroadcastAudiencePreview(filters, range, 20);
    return res.json({
      filters: helpers.withBroadcastStreakRange(filters, range),
      count: preview.count,
      sample: preview.sample
    });
  });

  router.post('/admin/broadcast-media', requireAdmin, broadcastMediaUpload.single('file'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!ctx.env.broadcastMediaChatId) {
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

    const botSelection = helpers.validateBroadcastBotSelection(
      helpers.parseBotKeysField(req.body?.bots ?? req.body?.botKeys ?? req.body?.bot_keys)
    );
    if (!botSelection.ok) {
      return res.status(400).json({ error: botSelection.error });
    }
    const targetBots = botSelection.botKeys;

    const mediaFileIds = {};
    for (const botKey of targetBots) {
      try {
        const uploaded = await helpers.uploadTelegramMediaToChat({
          chatId: ctx.env.broadcastMediaChatId,
          messageKind,
          buffer: file.buffer,
          filename: file.originalname,
          mimeType: file.mimetype,
          botKey
        });
        mediaFileIds[botKey] = uploaded.fileId;
      } catch (err) {
        const msg = helpers.sanitizeErrorText(err?.message || String(err)) || 'upload_failed';
        return res.status(502).json({ error: 'telegram_upload_failed', bot_key: botKey, detail: msg });
      }
    }

    return res.json({ ok: true, messageKind, mediaFileIds });
  });

  router.post('/admin/broadcast-campaigns', requireAdmin, async (req, res) => {
    const range = helpers.parseAdminRange(req);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const filters = helpers.normalizeBroadcastFilters(req.body?.filters ?? req.body ?? {});
    const botSelection = helpers.validateBroadcastBotSelection(filters.bots);
    if (!botSelection.ok) {
      return res.status(400).json({ error: botSelection.error });
    }
    filters.bots = botSelection.botKeys;
    const messageKindRaw = (req.body?.messageKind ?? req.body?.message_kind ?? 'text').toString().trim().toLowerCase();
    const messageKind = helpers.BROADCAST_MESSAGE_KINDS.has(messageKindRaw) ? messageKindRaw : null;
    if (!messageKind) {
      return res.status(400).json({ error: 'bad_message_kind' });
    }

    const mediaUrlRaw = (req.body?.mediaUrl ?? req.body?.media_url ?? '').toString().trim();
    if (mediaUrlRaw.length > helpers.BROADCAST_MEDIA_URL_MAX_LEN) {
      return res.status(400).json({ error: 'media_url_too_long', max_length: helpers.BROADCAST_MEDIA_URL_MAX_LEN });
    }
    const mediaUrl = mediaUrlRaw;
    const mediaFileIdRaw = (req.body?.mediaFileId ?? req.body?.media_file_id ?? '').toString().trim();
    if (mediaFileIdRaw.length > helpers.BROADCAST_MEDIA_FILE_ID_MAX_LEN) {
      return res.status(400).json({ error: 'media_file_id_too_long', max_length: helpers.BROADCAST_MEDIA_FILE_ID_MAX_LEN });
    }
    const mediaFileId = mediaFileIdRaw;
    const mediaFileIds = helpers.normalizeBroadcastMediaFileIds(req.body?.mediaFileIds ?? req.body?.media_file_ids);
    const replyMarkupRaw =
      req.body?.replyMarkup
      ?? req.body?.reply_markup
      ?? req.body?.inlineKeyboard
      ?? req.body?.inline_keyboard
      ?? null;
    const replyMarkupResult = helpers.normalizeBroadcastReplyMarkup(replyMarkupRaw);
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
      if (messageText.length > helpers.BROADCAST_MESSAGE_MAX_LEN) {
        return res.status(400).json({
          error: 'message_too_long',
          max_length: helpers.BROADCAST_MESSAGE_MAX_LEN
        });
      }
      if (mediaUrl || mediaFileId || mediaFileIds) {
        return res.status(400).json({ error: 'unexpected_media' });
      }
    } else {
      if (!mediaUrl && !mediaFileId && !mediaFileIds) {
        return res.status(400).json({ error: 'missing_media' });
      }
      if (messageText.length > helpers.BROADCAST_CAPTION_MAX_LEN) {
        return res.status(400).json({
          error: 'caption_too_long',
          max_length: helpers.BROADCAST_CAPTION_MAX_LEN
        });
      }
    }

    const recipients = await helpers.listBroadcastRecipients(filters, range, ctx.env.broadcastMaxRecipients + 1);
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'empty_audience' });
    }
    if (recipients.length > ctx.env.broadcastMaxRecipients) {
      return res.status(400).json({
        error: 'too_many_recipients',
        max_recipients: ctx.env.broadcastMaxRecipients,
        matched: recipients.length
      });
    }

    const chatIds = recipients.map((r) => Number(r.chat_id));
    const usernames = recipients.map((r) => r.username || null);
    const firstNames = recipients.map((r) => r.first_name || null);
    const fallbackBotKey = normalizeBotKey(ctx.env.defaultBotKey) || 'uk-de';
    const botKeys = recipients.map((r) => normalizeBotKey(r.bot_key) || fallbackBotKey);
    const createdByRaw = (req.headers['x-admin-user'] || 'admin_dashboard').toString().trim();
    const createdBy = createdByRaw ? createdByRaw.slice(0, 120) : 'admin_dashboard';
    const storedFilters = helpers.withBroadcastStreakRange(filters, range);

    let campaignId = null;
    await ctx.pool.query('BEGIN');
    try {
      const { rows: campaignRows } = await ctx.pool.query(
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

      await ctx.pool.query(
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

      await ctx.pool.query('COMMIT');
    } catch (err) {
      await ctx.pool.query('ROLLBACK');
      throw err;
    }

    await enqueueBroadcastCampaignJob(ctx.apiBoss, campaignId);

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

  router.get('/admin/broadcast-campaigns/:id', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const campaignId = Number(req.params.id);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'bad_campaign_id' });
    }

    const { rows: campaignRows } = await ctx.pool.query(
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

    const { rows: failedRows } = await ctx.pool.query(
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

  return router;
}
