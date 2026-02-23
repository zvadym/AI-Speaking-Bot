import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { response, body };
}

function buildTelegramInitData({ token, user }) {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const queryId = `AA${Date.now()}`;

  const params = new URLSearchParams();
  params.set('auth_date', authDate);
  params.set('query_id', queryId);
  params.set('user', JSON.stringify(user));

  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

function buildStripeSignatureHeader({ payload, secret }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function loadFirstBotToken() {
  const botsDir = path.resolve('deploy/bots');
  const files = fs.readdirSync(botsDir).filter((file) => file.endsWith('.json')).sort();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(botsDir, file), 'utf8');
    const parsed = JSON.parse(raw);
    const token = (parsed.telegram_bot_token || '').trim();
    if (token && !token.startsWith('YOUR_')) {
      return token;
    }
  }
  throw new Error('No usable telegram_bot_token found in deploy/bots/*.json');
}

async function waitFor(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const apiBase = process.env.E2E_API_BASE || 'http://127.0.0.1:3001';
  const n8nBase = process.env.E2E_N8N_BASE || 'http://127.0.0.1:5678';
  const stripeWebhookSecret = process.env.E2E_STRIPE_WEBHOOK_SECRET || 'whsec_e2e_secret';

  await waitFor(`${apiBase}/healthz`);
  await waitFor(`${n8nBase}/healthz`);

  const health = await requestJson(`${apiBase}/healthz`);
  assert(health.response.ok, `healthz failed: ${JSON.stringify(health.body)}`);
  assert(health.body?.ok === true, 'healthz payload does not contain { ok: true }');

  const token = loadFirstBotToken();
  const chatId = 900000 + Math.floor(Math.random() * 100000);
  const initData = buildTelegramInitData({
    token,
    user: {
      id: chatId,
      username: 'e2e_user',
      first_name: 'E2E'
    }
  });

  const authResult = await requestJson(`${apiBase}/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData })
  });
  assert(authResult.response.ok, `auth/telegram failed: ${JSON.stringify(authResult.body)}`);
  assert(authResult.body?.token, 'auth/telegram did not return token');

  const authHeader = { authorization: `Bearer ${authResult.body.token}` };

  const meBefore = await requestJson(`${apiBase}/me`, { headers: authHeader });
  assert(meBefore.response.ok, `/me failed: ${JSON.stringify(meBefore.body)}`);
  assert(
    Number(meBefore.body?.user?.chat_id) === chatId,
    `/me chat_id mismatch: ${JSON.stringify(meBefore.body)}`
  );
  assert(meBefore.body?.user?.plan_tier === 'free', `Expected free tier initially: ${JSON.stringify(meBefore.body)}`);

  const plans = await requestJson(`${apiBase}/plans?include_all_intervals=true`, { headers: authHeader });
  assert(plans.response.ok, `/plans failed: ${JSON.stringify(plans.body)}`);
  assert(Array.isArray(plans.body?.plans) && plans.body.plans.length > 0, '/plans returned no plans');
  const proPrice = plans.body.plans.find((plan) => plan.tier === 'pro' && plan.stripe_price_id);
  assert(proPrice?.stripe_price_id, 'No pro stripe_price_id found in /plans response');

  const customerId = `cus_e2e_${Date.now()}`;
  const subscriptionId = `sub_e2e_${Date.now()}`;

  const checkoutEventPayload = JSON.stringify({
    id: `evt_checkout_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        customer: customerId,
        subscription: subscriptionId,
        status: 'complete',
        client_reference_id: String(chatId),
        metadata: {
          chat_id: String(chatId),
          tier: 'pro'
        }
      }
    }
  });

  const checkoutWebhook = await fetch(`${apiBase}/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': buildStripeSignatureHeader({
        payload: checkoutEventPayload,
        secret: stripeWebhookSecret
      })
    },
    body: checkoutEventPayload
  });
  assert(checkoutWebhook.ok, `checkout webhook failed with status ${checkoutWebhook.status}`);

  const now = Math.floor(Date.now() / 1000);
  const subEventPayload = JSON.stringify({
    id: `evt_sub_${Date.now()}`,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: subscriptionId,
        customer: customerId,
        status: 'active',
        current_period_start: now,
        current_period_end: now + 86400 * 30,
        items: {
          data: [
            {
              id: `si_${Date.now()}`,
              price: {
                id: proPrice.stripe_price_id,
                currency: 'eur'
              }
            }
          ]
        }
      }
    }
  });

  const subWebhook = await fetch(`${apiBase}/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': buildStripeSignatureHeader({
        payload: subEventPayload,
        secret: stripeWebhookSecret
      })
    },
    body: subEventPayload
  });
  assert(subWebhook.ok, `subscription webhook failed with status ${subWebhook.status}`);

  const meAfter = await requestJson(`${apiBase}/me`, { headers: authHeader });
  assert(meAfter.response.ok, `/me after webhook failed: ${JSON.stringify(meAfter.body)}`);
  assert(meAfter.body?.user?.plan_tier === 'pro', `Expected pro after webhook: ${JSON.stringify(meAfter.body)}`);

  console.log('E2E smoke checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
