import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './env.js';
import { pool } from './db.js';
import { verifyInitData } from './telegram.js';
import { stripe } from './stripe.js';
import { signSession, requireAuth } from './auth.js';

const app = express();

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

app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : true }));
app.use(morgan('tiny'));
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
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

  return res.json({
    currency,
    user: userRows[0] || null,
    plans
  });
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
    success_url: `${env.webappUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.webappUrl}/cancel`,
    allow_promotion_codes: false,
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

async function handleStripeEvent(event) {
  const type = event.type;
  const obj = event.data.object;

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
      obj?.metadata?.chat_id ? Number(obj.metadata.chat_id) : null,
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
    const status = subscription.status;
    const isActive = ['active', 'trialing', 'past_due', 'unpaid'].includes(status);
    const planTier = isActive && tier ? tier : 'free';
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : new Date();
    const periodStart = subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000)
      : null;
    const autoRenew = !subscription.cancel_at_period_end;
    const currency = subscription.items?.data?.[0]?.price?.currency?.toUpperCase() || 'EUR';

    await pool.query(
      `UPDATE users
          SET plan_tier = $1,
              plan_started_at = COALESCE($2, plan_started_at),
              plan_expires_at = $3,
              plan_autorenew = $4,
              stripe_customer_id = $5,
              stripe_subscription_id = $6,
              stripe_price_id = $7,
              stripe_subscription_status = $8,
              billing_currency = $9,
              updated_at = NOW(),
              pending_plan_tier = NULL,
              pending_plan_effective_at = NULL
        WHERE stripe_customer_id = $5`,
      [
        planTier,
        periodStart,
        periodEnd,
        autoRenew,
        customerId,
        subscription.id,
        priceId,
        status,
        currency
      ]
    );
  }

  if (type === 'customer.subscription.deleted') {
    const subscription = obj;
    await pool.query(
      `UPDATE users
          SET plan_tier = 'free',
              plan_expires_at = NOW(),
              plan_autorenew = false,
              stripe_subscription_status = $1,
              updated_at = NOW()
        WHERE stripe_customer_id = $2`,
      [subscription.status, subscription.customer]
    );
  }
}

app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});
