import { timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { pool } from './db.js';
import { verifyInitData } from './telegram.js';
import { stripe } from './stripe.js';
import { signSession, requireAuth } from './auth.js';

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

app.get('/admin/metrics/summary', requireAdmin, async (req, res) => {
  const range = parseAdminRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  res.set('Cache-Control', 'no-store');

  const { rows } = await pool.query(
    `WITH filtered AS (
       SELECT
         created_at,
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
       SUM((effective_tier = 'plus')::int)::int AS plus_users_all_time,
       SUM((effective_tier = 'pro')::int)::int AS pro_users_all_time,
       COUNT(*) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz)::int AS total_users_in_range,
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
      plus_users_all_time: 0,
      pro_users_all_time: 0,
      total_users_in_range: 0,
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

  await upsertUser(user);

  const token = signSession({ chatId: user.id, username: user.username || null });
  console.info('auth/telegram ok', {
    chatId: user.id,
    username: user.username || null
  });
  return res.json({ token, user: { id: user.id, username: user.username || null, first_name: user.first_name || null } });
});

app.get('/plans', requireAuth, async (req, res) => {
  const currency = (req.query.currency || 'EUR').toString().toUpperCase();
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
      WHERE p.tier IN ('plus','pro')
      ORDER BY p.tier`,
    [currency]
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
  const { rows } = await pool.query(
    `SELECT chat_id, username, first_name, target_lang, level, onboarding_state, reply_mode, tts_voice,
            plan_tier, plan_expires_at, plan_autorenew
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const user = rows[0] || null;
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user });
});

app.post('/me/target-lang', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const raw = (req.body?.target_lang ?? req.body?.targetLang ?? '').toString().trim().toLowerCase();
  if (!['en', 'de'].includes(raw)) {
    return res.status(400).json({ error: 'bad_target_lang' });
  }

  const { rows } = await pool.query(
    `UPDATE users
        SET target_lang = $1,
            onboarding_state = 'await_level',
            updated_at = NOW()
      WHERE chat_id = $2
      RETURNING chat_id, username, first_name, target_lang, level, onboarding_state, reply_mode, tts_voice,
                plan_tier, plan_expires_at, plan_autorenew`,
    [raw, chatId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user: rows[0] });
});

app.post('/me/level', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const raw = (req.body?.level ?? '').toString().trim().toLowerCase();
  if (!['a1', 'a2', 'b1', 'b2', 'c1'].includes(raw)) {
    return res.status(400).json({ error: 'bad_level' });
  }

  const { rows } = await pool.query(
    `UPDATE users
        SET level = $1,
            onboarding_state = 'ready',
            updated_at = NOW()
      WHERE chat_id = $2
      RETURNING chat_id, username, first_name, target_lang, level, onboarding_state, reply_mode, tts_voice,
                plan_tier, plan_expires_at, plan_autorenew`,
    [raw, chatId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ user: rows[0] });
});

app.post('/billing/checkout', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const { tier, currency } = req.body || {};
  const normalizedTier = String(tier || '').toLowerCase();
  if (!['plus', 'pro'].includes(normalizedTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }

  const billingCurrency = (currency || 'EUR').toString().toUpperCase();

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND active = true
      LIMIT 1`,
    [normalizedTier, billingCurrency]
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
    metadata: { chat_id: String(chatId), tier: normalizedTier }
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
  const { tier, currency } = req.body || {};
  const normalizedTier = String(tier || '').toLowerCase();
  if (!['plus', 'pro'].includes(normalizedTier)) {
    return res.status(400).json({ error: 'bad_tier' });
  }

  const billingCurrency = (currency || 'EUR').toString().toUpperCase();

  const { rows: priceRows } = await pool.query(
    `SELECT stripe_price_id
       FROM plan_prices
      WHERE tier = $1 AND currency = $2 AND active = true
      LIMIT 1`,
    [normalizedTier, billingCurrency]
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
    metadata: { chat_id: String(chatId), tier: normalizedTier }
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
  if (!['plus', 'pro'].includes(targetTier)) {
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
  if (!['plus', 'pro'].includes(targetTier)) {
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
  const chatId = req.auth.chatId;
  const { tier } = req.body || {};
  const targetTier = String(tier || '').toLowerCase();
  if (targetTier !== 'plus') {
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
      expand: ['items.data.price', 'schedule']
    });
  } catch (err) {
    console.error('Stripe: failed to retrieve subscription for downgrade', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  const subscriptionItem = subscription.items?.data?.[0] || null;
  const currentPriceId = subscriptionItem?.price?.id || null;
  const currency = subscriptionItem?.price?.currency?.toUpperCase() || null;
  const billingInterval = subscriptionItem?.price?.recurring?.interval || 'month';
  const periodEndSeconds = typeof subscription.current_period_end === 'number' ? subscription.current_period_end : null;
  const quantity = subscriptionItem?.quantity || 1;

  if (!subscriptionItem?.id || !currentPriceId || !currency || !periodEndSeconds) {
    return res.status(400).json({ error: 'subscription_not_downgradeable' });
  }

  const currentTier = await resolveTierByPrice(currentPriceId);
  const tierRank = { free: 0, plus: 1, pro: 2 };
  if (!currentTier || (tierRank[targetTier] ?? 0) >= (tierRank[currentTier] ?? 0)) {
    return res.status(400).json({ error: 'not_a_downgrade', current_tier: currentTier });
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

  const existingScheduleId =
    typeof subscription.schedule === 'string'
      ? subscription.schedule
      : typeof subscription.schedule === 'object'
        ? subscription.schedule?.id || null
        : null;

  let scheduleId = existingScheduleId;
  if (!scheduleId) {
    try {
      const created = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });
      scheduleId = created.id;
    } catch (err) {
      console.error('Stripe: failed to create subscription schedule for downgrade', err);
      return res.status(500).json({ error: 'stripe_error' });
    }
  }

  let schedule;
  try {
    schedule = await stripe.subscriptionSchedules.retrieve(scheduleId, {
      expand: ['phases.items.price']
    });
  } catch (err) {
    console.error('Stripe: failed to retrieve subscription schedule for downgrade', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  const scheduleStart =
    typeof schedule?.phases?.[0]?.start_date === 'number'
      ? schedule.phases[0].start_date
      : typeof schedule?.start_date === 'number'
        ? schedule.start_date
        : Math.floor(Date.now() / 1000);

  if (periodEndSeconds <= scheduleStart) {
    return res.status(400).json({ error: 'bad_period_end' });
  }

  try {
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: 'release',
      phases: [
        {
          start_date: scheduleStart,
          end_date: periodEndSeconds,
          items: [{ price: currentPriceId, quantity }]
        },
        {
          start_date: periodEndSeconds,
          iterations: 1,
          items: [{ price: targetPriceId, quantity }]
        }
      ]
    });
  } catch (err) {
    console.error('Stripe: failed to update subscription schedule for downgrade', err);
    return res.status(500).json({ error: 'stripe_error' });
  }

  await pool.query(
    `UPDATE users
        SET pending_plan_tier = $1,
            pending_plan_effective_at = $2,
            updated_at = NOW()
      WHERE chat_id = $3`,
    [targetTier, new Date(periodEndSeconds * 1000), chatId]
  );

  return res.json({
    ok: true,
    scheduled: true,
    current_tier: currentTier,
    target_tier: targetTier,
    effective_at: new Date(periodEndSeconds * 1000).toISOString(),
    currency,
    billing_interval: billingInterval
  });
});

async function upsertUser(user) {
  const chatId = user.id;
  const username = user.username || null;
  const firstName = user.first_name || null;

  await pool.query(
    `INSERT INTO users (chat_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       updated_at = NOW()`,
    [chatId, username, firstName]
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
    const resp = await fetch(env.planChangedWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn('Plan change webhook failed', { status: resp.status, body });
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
                WHEN plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2 IS NOT NULL THEN $2
                ELSE plan_started_at
              END,
              plan_started_tier = CASE
                WHEN plan_started_tier IS NULL AND plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2 IS NOT NULL THEN $1
                ELSE plan_started_tier
              END,
              plan_expires_at = COALESCE($3, plan_expires_at),
              plan_autorenew = $4,
              stripe_customer_id = $5,
              stripe_subscription_id = $6,
              stripe_price_id = $7,
              stripe_subscription_status = $8,
              billing_currency = $9,
              updated_at = NOW(),
              pending_plan_tier = $10,
              pending_plan_effective_at = $11
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
                    WHEN plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2 IS NOT NULL THEN $2
                    ELSE plan_started_at
                  END,
                  plan_started_tier = CASE
                    WHEN plan_started_tier IS NULL AND plan_started_at IS NULL AND $1 IN ('plus', 'pro') AND $2 IS NOT NULL THEN $1
                    ELSE plan_started_tier
                  END,
                  plan_expires_at = COALESCE($3, plan_expires_at),
                  plan_autorenew = $4,
                  stripe_customer_id = $5,
                  stripe_subscription_id = $6,
                  stripe_price_id = $7,
                  stripe_subscription_status = $8,
                  billing_currency = $9,
                  updated_at = NOW(),
                  pending_plan_tier = $10,
                  pending_plan_effective_at = $11
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
