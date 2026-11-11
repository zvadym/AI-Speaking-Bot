import { Router } from 'express';
import { createRequireAuth } from '../auth.js';
import {
  normalizeBillingInterval,
  normalizeBotKey,
  normalizeRuntimeCurrencyCode,
  PURCHASE_ALLOWED_TIERS
} from '../shared/normalization.js';
import { captureException } from '../sentry.js';

export function createBillingRouter(ctx, helpers) {
  const router = Router();
  const requireAuth = createRequireAuth(ctx.env);

  router.get('/plans', requireAuth, async (req, res) => {
    const includeAllIntervals = helpers.parseQueryBoolean(
      req.query.include_all_intervals ?? req.query.includeAllIntervals
    );
    const chatId = req.auth.chatId;
    const requestedCurrency = req.query.currency;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
    const meUser = await helpers.getMeUserRow(chatId, requestedBotKey);
    const baseLanguage = meUser?.base_language || null;
    const availableCurrencies = helpers.getAllowedBillingCurrencies(baseLanguage);

    try {
      const { rows: userRows } = await ctx.pool.query(
        `SELECT plan_tier, plan_expires_at, plan_autorenew, pending_plan_tier, pending_plan_effective_at,
                override_plan_tier, override_expires_at, billing_currency, preferred_billing_currency, stripe_subscription_status
           FROM users
          WHERE chat_id = $1
          LIMIT 1`,
        [chatId]
      );

      const user = userRows[0] || null;
      const usage = user ? await helpers.getUserUsageSummary(chatId) : null;
      const effectiveTier = (usage?.tier || user?.plan_tier || 'free').toString().trim().toLowerCase();
      const currency = helpers.resolvePlanCurrencySelection({
        requestedCurrency,
        allowedCurrencies: availableCurrencies,
        billingCurrency: user?.billing_currency,
        preferredCurrency: user?.preferred_billing_currency,
        allowBillingCurrency: effectiveTier !== 'free' && helpers.isStripeBackedPaidStatus(user?.stripe_subscription_status)
      });
      const plans = await helpers.loadPlanCatalog(currency, includeAllIntervals, { includeStripePriceId: true });
      if (user && effectiveTier !== 'pro') {
        await helpers.recordActionEventSafe({
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

      return res.json(helpers.buildPlanCatalogResponse({
        currency,
        user,
        plans,
        usage,
        baseLanguage,
        availableCurrencies
      }));
    } catch (err) {
      console.warn('plans personalized payload failed; returning catalog only', {
        chatId,
        botKey: req.auth?.botKey || null,
        err: err?.message || String(err)
      });
    }

    const currency = helpers.resolvePlanCurrencySelection({
      requestedCurrency,
      allowedCurrencies: availableCurrencies,
      billingCurrency: null,
      preferredCurrency: meUser?.preferred_billing_currency,
      allowBillingCurrency: false
    });
    const plans = await helpers.loadPlanCatalog(currency, includeAllIntervals, { includeStripePriceId: true });
    return res.json(helpers.buildPlanCatalogResponse({
      currency,
      user: null,
      plans,
      usage: null,
      baseLanguage,
      availableCurrencies
    }));
  });

  router.post('/billing/checkout', requireAuth, async (req, res) => {
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

    const { rows: priceRows } = await ctx.pool.query(
      `SELECT stripe_price_id
         FROM plan_prices
        WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
        LIMIT 1`,
      [normalizedTier, billingCurrency, normalizedBillingInterval]
    );

    if (!priceRows[0]?.stripe_price_id) {
      return res.status(400).json({ error: 'price_not_found' });
    }

    const { rows: userRows } = await ctx.pool.query(
      `SELECT stripe_customer_id
         FROM users
        WHERE chat_id = $1
        LIMIT 1`,
      [chatId]
    );

    let stripeCustomerId = userRows[0]?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      const customer = await ctx.stripe.customers.create({
        metadata: { telegram_chat_id: String(chatId) }
      });

      stripeCustomerId = customer.id;

      await ctx.pool.query(
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
      success_url: ctx.env.webappReturnUrlIsCustom
        ? ctx.env.webappReturnUrl
        : `${ctx.env.webappUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: ctx.env.webappReturnUrlIsCustom ? ctx.env.webappReturnUrl : `${ctx.env.webappUrl}/cancel`,
      allow_promotion_codes: true,
      metadata: {
        chat_id: String(chatId),
        tier: normalizedTier,
        billing_interval: normalizedBillingInterval
      }
    };

    let session;
    try {
      session = await ctx.stripe.checkout.sessions.create(sessionParams);
    } catch (err) {
      if (err?.type === 'StripeInvalidRequestError' && err?.code === 'resource_missing' && err?.param === 'customer') {
        const customer = await ctx.stripe.customers.create({
          metadata: { telegram_chat_id: String(chatId) }
        });

        stripeCustomerId = customer.id;

        await ctx.pool.query(
          `UPDATE users
              SET stripe_customer_id = $1,
                  updated_at = NOW()
            WHERE chat_id = $2`,
          [stripeCustomerId, chatId]
        );

        session = await ctx.stripe.checkout.sessions.create({
          ...sessionParams,
          customer: stripeCustomerId
        });
      } else {
        console.error('Stripe checkout failed', err);
        captureException(err, {
          tags: { route: 'billing-checkout' },
          extra: { chatId, tier: normalizedTier, billingCurrency, billingInterval: normalizedBillingInterval }
        });
        return res.status(500).json({ error: 'stripe_error' });
      }
    }

    return res.json({ url: session.url });
  });

  router.post('/billing/checkout/embedded', requireAuth, async (req, res) => {
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

    const { rows: priceRows } = await ctx.pool.query(
      `SELECT stripe_price_id
         FROM plan_prices
        WHERE tier = $1 AND currency = $2 AND billing_interval = $3 AND active = true
        LIMIT 1`,
      [normalizedTier, billingCurrency, normalizedBillingInterval]
    );

    if (!priceRows[0]?.stripe_price_id) {
      return res.status(400).json({ error: 'price_not_found' });
    }

    const { rows: userRows } = await ctx.pool.query(
      `SELECT stripe_customer_id
         FROM users
        WHERE chat_id = $1
        LIMIT 1`,
      [chatId]
    );

    let stripeCustomerId = userRows[0]?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      const customer = await ctx.stripe.customers.create({
        metadata: { telegram_chat_id: String(chatId) }
      });

      stripeCustomerId = customer.id;

      await ctx.pool.query(
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
      return_url: ctx.env.webappReturnUrlIsCustom
        ? ctx.env.webappReturnUrl
        : `${ctx.env.webappUrl}/success`,
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
      session = await ctx.stripe.checkout.sessions.create(sessionParams);
    } catch (err) {
      if (err?.type === 'StripeInvalidRequestError' && err?.code === 'resource_missing' && err?.param === 'customer') {
        const customer = await ctx.stripe.customers.create({
          metadata: { telegram_chat_id: String(chatId) }
        });

        stripeCustomerId = customer.id;

        await ctx.pool.query(
          `UPDATE users
              SET stripe_customer_id = $1,
                  updated_at = NOW()
            WHERE chat_id = $2`,
          [stripeCustomerId, chatId]
        );

        session = await ctx.stripe.checkout.sessions.create({
          ...sessionParams,
          customer: stripeCustomerId
        });
      } else {
        console.error('Stripe embedded checkout failed', err);
        captureException(err, {
          tags: { route: 'billing-checkout-embedded' },
          extra: { chatId, tier: normalizedTier, billingCurrency, billingInterval: normalizedBillingInterval }
        });
        return res.status(500).json({ error: 'stripe_error' });
      }
    }

    if (!session?.client_secret) {
      console.error('Stripe embedded checkout: missing client_secret', { id: session?.id });
      captureException(new Error('Stripe embedded checkout missing client_secret'), {
        tags: { route: 'billing-checkout-embedded' },
        extra: { chatId, sessionId: session?.id || null }
      });
      return res.status(500).json({ error: 'stripe_error' });
    }

    return res.json({ client_secret: session.client_secret, id: session.id });
  });

  router.post('/billing/cancel', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const { rows } = await ctx.pool.query(
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

    const updated = await ctx.stripe.subscriptions.update(subId, {
      cancel_at_period_end: true
    });

    await ctx.pool.query(
      `UPDATE users
          SET plan_autorenew = false,
              stripe_subscription_status = $1,
              updated_at = NOW()
        WHERE chat_id = $2`,
      [updated.status, chatId]
    );

    return res.json({ ok: true, status: updated.status });
  });

  router.post('/billing/resume', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const { rows } = await ctx.pool.query(
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

    const updated = await ctx.stripe.subscriptions.update(subId, {
      cancel_at_period_end: false
    });

    await ctx.pool.query(
      `UPDATE users
          SET plan_autorenew = true,
              stripe_subscription_status = $1,
              updated_at = NOW()
        WHERE chat_id = $2`,
      [updated.status, chatId]
    );

    return res.json({ ok: true, status: updated.status });
  });

  router.post('/billing/portal', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const { rows } = await ctx.pool.query(
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
        const sub = await ctx.stripe.subscriptions.retrieve(subscriptionId);
        if (typeof sub?.customer === 'string') {
          customerId = sub.customer;
          await ctx.pool.query(
            `UPDATE users
                SET stripe_customer_id = $1,
                    updated_at = NOW()
              WHERE chat_id = $2`,
            [customerId, chatId]
          );
        }
      } catch (err) {
        console.error('Stripe: failed to retrieve subscription for portal', err);
        captureException(err, {
          tags: { route: 'billing-portal' },
          extra: { chatId, subscriptionId }
        });
        return res.status(500).json({ error: 'stripe_error' });
      }
    }

    if (!customerId) {
      return res.status(400).json({ error: 'no_customer' });
    }

    try {
      const params = {
        customer: customerId,
        return_url: ctx.env.webappReturnUrl
      };
      if (ctx.env.stripePortalConfigId) {
        params.configuration = ctx.env.stripePortalConfigId;
      }
      const session = await ctx.stripe.billingPortal.sessions.create(params);
      return res.json({ url: session.url });
    } catch (err) {
      console.error('Stripe: billing portal session create failed', err);
      captureException(err, {
        tags: { route: 'billing-portal' },
        extra: { chatId, customerId }
      });
      return res.status(500).json({ error: 'stripe_error' });
    }
  });

  router.post('/billing/upgrade/preview', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const { tier } = req.body || {};
    const targetTier = String(tier || '').toLowerCase();
    if (!PURCHASE_ALLOWED_TIERS.has(targetTier)) {
      return res.status(400).json({ error: 'bad_tier' });
    }

    const { rows: userRows } = await ctx.pool.query(
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
      subscription = await ctx.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price']
      });
    } catch (err) {
      console.error('Stripe: failed to retrieve subscription for upgrade preview', err);
      captureException(err, {
        tags: { route: 'billing-upgrade-preview' },
        extra: { chatId, subscriptionId }
      });
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

    const currentTier = await helpers.resolveTierByPrice(currentPriceId);
    const tierRank = { free: 0, pro: 1 };
    if (currentTier && (tierRank[targetTier] ?? 0) <= (tierRank[currentTier] ?? 0)) {
      return res.status(400).json({ error: 'not_an_upgrade', current_tier: currentTier });
    }

    const { rows: priceRows } = await ctx.pool.query(
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
    try {
      const upcoming = await ctx.stripe.invoices.retrieveUpcoming({
        subscription: subscriptionId,
        subscription_items: [{ id: subscriptionItem.id, price: targetPriceId, quantity }],
        subscription_proration_behavior: 'always_invoice',
        subscription_proration_date: prorationDate
      });

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
    } catch (err) {
      console.error('Stripe: failed to preview upgrade invoice', err);
      captureException(err, {
        tags: { route: 'billing-upgrade-preview' },
        extra: { chatId, subscriptionId, targetTier }
      });
      return res.status(500).json({ error: 'stripe_error' });
    }
  });

  router.post('/billing/upgrade', requireAuth, async (req, res) => {
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

    const { rows: userRows } = await ctx.pool.query(
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
      subscription = await ctx.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price', 'latest_invoice.payment_intent', 'latest_invoice']
      });
    } catch (err) {
      console.error('Stripe: failed to retrieve subscription for upgrade', err);
      captureException(err, {
        tags: { route: 'billing-upgrade' },
        extra: { chatId, subscriptionId }
      });
      return res.status(500).json({ error: 'stripe_error' });
    }

    const subscriptionItem = subscription.items?.data?.[0] || null;
    const currentPriceId = subscriptionItem?.price?.id || null;
    const currency = subscriptionItem?.price?.currency?.toUpperCase() || null;
    const billingInterval = subscriptionItem?.price?.recurring?.interval || 'month';
    if (!subscriptionItem?.id || !currentPriceId || !currency) {
      return res.status(400).json({ error: 'subscription_not_upgradeable' });
    }

    const currentTier = await helpers.resolveTierByPrice(currentPriceId);
    const tierRank = { free: 0, pro: 1 };
    if (currentTier && (tierRank[targetTier] ?? 0) <= (tierRank[currentTier] ?? 0)) {
      return res.status(400).json({ error: 'not_an_upgrade', current_tier: currentTier });
    }

    const { rows: priceRows } = await ctx.pool.query(
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
      updated = await ctx.stripe.subscriptions.update(subscriptionId, updateParams);
    } catch (err) {
      console.error('Stripe: upgrade failed', err);
      captureException(err, {
        tags: { route: 'billing-upgrade' },
        extra: { chatId, subscriptionId, targetTier }
      });
      return res.status(500).json({ error: 'stripe_error' });
    }

    const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null;
    const paymentIntent = typeof invoice?.payment_intent === 'object' ? invoice.payment_intent : null;
    const pendingUpgrade = Boolean(updated.pending_update);

    if (pendingUpgrade) {
      await ctx.pool.query(
        `UPDATE users
            SET pending_plan_tier = $1,
                pending_plan_effective_at = NOW(),
                updated_at = NOW()
          WHERE chat_id = $2`,
        [targetTier, chatId]
      );
    } else {
      await ctx.pool.query(
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

  router.post('/billing/downgrade', requireAuth, async (_req, res) => {
    return res.status(400).json({ error: 'plan_change_unavailable' });
  });

  return router;
}
