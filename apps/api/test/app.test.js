import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/test_db';
process.env.WEBAPP_URL ??= 'https://example.test/app';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_123';
process.env.JWT_SECRET ??= 'jwt_secret_for_tests';
process.env.ADMIN_DASHBOARD_PASSWORD ??= 'secret-admin';
process.env.INTERNAL_API_SECRET ??= 'internal-secret';

const [{ createApp }, { pool }, { signSession }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db.js'),
  import('../src/auth.js')
]);

async function request(app, { method = 'GET', path = '/', headers = {}, body } = {}) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}${path}`;
  const nextHeaders = { ...headers };
  if (body !== undefined && !Object.keys(nextHeaders).some((key) => key.toLowerCase() === 'content-type')) {
    nextHeaders['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method,
      headers: nextHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { status: response.status, raw, json };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function withMockedQuery(handler, run) {
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => handler(typeof sql === 'string' ? sql : sql?.text || '', params);
  try {
    await run();
  } finally {
    pool.query = originalQuery;
  }
}

async function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (typeof url === 'string' && url.startsWith('https://api.telegram.org/')) {
      return handler(url, init);
    }
    return originalFetch(input, init);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createMiniappQueryHandler() {
  const baseUserRow = {
    chat_id: 42,
    username: 'alice',
    first_name: 'Alice',
    bot_key: 'uk-de',
    target_lang: 'de',
    level: 'a2',
    reply_mode: 'text',
    tts_voice: 'marin',
    plan_tier: 'free',
    plan_expires_at: null,
    plan_autorenew: false,
    billing_currency: 'EUR',
    preferred_billing_currency: 'EUR',
    stripe_subscription_status: null
  };

  return async (source, params = []) => {
    if (source.includes('FROM plans p')) {
      return {
        rows: [{
          tier: 'pro',
          voice_seconds_limit: 3600,
          voice_limit_period: 'month',
          currency: 'EUR',
          amount_cents: 1900,
          billing_interval: 'month'
        }]
      };
    }

    if (source.includes('SELECT plan_tier, plan_expires_at, plan_autorenew')) {
      return {
        rows: [{
          plan_tier: 'free',
          plan_expires_at: null,
          plan_autorenew: false,
          pending_plan_tier: null,
          pending_plan_effective_at: null,
          override_plan_tier: null,
          override_expires_at: null,
          billing_currency: 'EUR',
          stripe_subscription_status: null
        }]
      };
    }

    if (source.includes('WITH user_plan AS')) {
      return {
        rows: [{
          tier: 'free',
          plan_expires_at: null,
          plan_autorenew: false,
          pending_plan_tier: null,
          pending_plan_effective_at: null,
          limit_period: 'month',
          limit_seconds: 3600,
          used_seconds: 420,
          remaining_seconds: 3180,
          limit_reached: false
        }]
      };
    }

    if (source.includes('LEFT JOIN user_bots ub')) {
      const requestedBotKey = params[1] || 'uk-de';
      return {
        rows: [{
          ...baseUserRow,
          bot_key: requestedBotKey,
          target_lang: requestedBotKey.split('-')[1] || 'de',
          level: requestedBotKey === 'uk-en' ? 'b1' : baseUserRow.level,
          reply_mode: requestedBotKey === 'uk-en' ? 'voice' : baseUserRow.reply_mode
        }]
      };
    }

    if (source.includes('FROM user_bots ub') && source.includes('split_part(ub.bot_key')) {
      return {
        rows: [
          {
            bot_key: 'uk-de',
            target_lang: 'de',
            level: 'a2',
            reply_mode: 'text',
            tts_voice: 'marin',
            is_active: true,
            last_seen_at: '2026-03-11T08:00:00.000Z'
          },
          {
            bot_key: 'uk-en',
            target_lang: 'en',
            level: 'b1',
            reply_mode: 'voice',
            tts_voice: 'marin',
            is_active: false,
            last_seen_at: '2026-03-10T08:00:00.000Z'
          }
        ]
      };
    }

    if (source.includes('FROM user_bots') && source.includes('COALESCE(is_active, true) DESC')) {
      return { rows: [{ bot_key: 'uk-de' }] };
    }

    if (source.includes('WITH activity AS')) {
      return {
        rows: [{
          current_streak_days: 4,
          longest_streak_days: 11,
          streak_status: 'active',
          activity_today: true,
          last_activity_at: '2026-03-11T08:30:00.000Z',
          recent_activity_days: ['2026-03-09', '2026-03-10', '2026-03-11']
        }]
      };
    }

    if (source.includes('FROM user_progress up')) {
      return { rows: [{ xp_total: 340, xp_level: 2 }] };
    }

    if (source.includes('FROM feedback_threads') && source.includes('LIMIT 1')) {
      return { rows: [{ archived_at: null, user_last_read_at: '2026-03-11T07:00:00.000Z' }] };
    }

    if (source.includes('FROM feedback_replies r') && source.includes('COUNT(*)::int AS unread_admin_replies')) {
      return { rows: [{ unread_admin_replies: 1 }] };
    }

    if (source.includes('FROM feedback f') && source.includes('ORDER BY created_at DESC')) {
      return {
        rows: [{
          sender: 'admin',
          created_at: '2026-03-11T07:15:00.000Z',
          text: 'Try the new drills.'
        }]
      };
    }

    if (source.includes('SET preferred_billing_currency')) {
      return { rows: [{ preferred_billing_currency: params[0] }] };
    }

    if (source.includes('INSERT INTO feedback (')) {
      return {
        rows: [{
          id: 77,
          created_at: '2026-03-11T09:00:00.000Z',
          feedback_text: params[3],
          category: params[5]
        }]
      };
    }

    if (source.includes('INSERT INTO feedback_threads')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('INSERT INTO user_bots') && source.includes('level = EXCLUDED.level')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('INSERT INTO action_events')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in miniapp app test: ${source.slice(0, 140)}`);
  };
}

test('createApp serves smoke routes without infrastructure side effects', async () => {
  await withMockedQuery(async (source) => {
    if (source.includes('FROM plan_prices') || source.includes('FROM plans p')) return { rows: [] };
    if (source.includes('FROM user_bots') && source.includes('ORDER BY')) {
      return { rows: [{ bot_key: 'uk-de' }] };
    }
    if (source.includes('LEFT JOIN user_bots ub')) {
      return {
        rows: [{
          chat_id: 42,
          username: 'alice',
          first_name: 'Alice',
          bot_key: 'uk-de',
          target_lang: 'de',
          level: 'a2',
          reply_mode: 'text',
          tts_voice: 'marin',
          plan_tier: 'free',
          plan_expires_at: null,
          plan_autorenew: false,
          billing_currency: 'EUR',
          preferred_billing_currency: 'EUR',
          stripe_subscription_status: null
        }]
      };
    }
    throw new Error(`Unexpected query in app smoke test: ${source.slice(0, 120)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });

    const health = await request(app, { path: '/healthz' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { ok: true });

    const authFailure = await request(app, {
      method: 'POST',
      path: '/auth/telegram',
      headers: { 'Content-Type': 'application/json' },
      body: {}
    });
    assert.equal(authFailure.status, 401);
    assert.equal(authFailure.json.error, 'missing_init_data');

    const adminDenied = await request(app, { path: '/admin/metrics/summary' });
    assert.equal(adminDenied.status, 401);
    assert.equal(adminDenied.json.error, 'unauthorized');

    const webhookMissingSig = await request(app, {
      method: 'POST',
      path: '/stripe/webhook',
      headers: { 'Content-Type': 'application/json' },
      body: {}
    });
    assert.equal(webhookMissingSig.status, 400);
    assert.equal(webhookMissingSig.raw, 'Missing stripe-signature');

    const plans = await request(app, { path: '/public/plans?currency=EUR' });
    assert.equal(plans.status, 200);
    assert.equal(plans.json.currency, 'EUR');
    assert.deepEqual(plans.json.plans, []);

    const token = signSession({ chatId: 42, username: 'alice', botKey: 'uk-de' });
    const me = await request(app, {
      path: '/me',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.chat_id, 42);
    assert.equal(me.json.user.bot_key, 'uk-de');
  });
});

test('createApp returns fresh app instances when apiBoss is injected', async () => {
  const bossA = { publish: async () => null };
  const bossB = { publish: async () => null };

  const appA = await createApp({ apiBoss: bossA });
  const appB = await createApp({ apiBoss: bossB });

  assert.notEqual(appA, appB);
  assert.equal(appA.locals.apiBoss, bossA);
  assert.equal(appB.locals.apiBoss, bossB);
});

test('miniapp read endpoints return personalized plans, dashboard, and bot catalog', async () => {
  await withMockedQuery(createMiniappQueryHandler(), async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const token = signSession({ chatId: 42, username: 'alice', botKey: 'uk-de' });
    const authHeaders = { Authorization: `Bearer ${token}` };

    const plans = await request(app, {
      path: '/plans?currency=EUR',
      headers: authHeaders
    });
    assert.equal(plans.status, 200);
    assert.equal(plans.json.currency, 'EUR');
    assert.equal(plans.json.user.plan_tier, 'free');
    assert.equal(plans.json.usage.used_seconds, 420);
    assert.equal(plans.json.plans[0].tier, 'pro');

    const dashboard = await request(app, {
      path: '/me/dashboard',
      headers: authHeaders
    });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.json.user.chat_id, 42);
    assert.equal(dashboard.json.selected_bot.bot_key, 'uk-de');
    assert.equal(dashboard.json.streak.current, 4);
    assert.equal(dashboard.json.xp.total, 340);
    assert.equal(dashboard.json.feedback_summary.unread_admin_replies, 1);

    const bots = await request(app, {
      path: '/me/bots',
      headers: authHeaders
    });
    assert.equal(bots.status, 200);
    assert.equal(bots.json.selected_bot_key, 'uk-de');
    assert.equal(bots.json.bots.length, 2);
    assert.equal(bots.json.bots[0].bot_key, 'uk-de');
    assert.ok(Array.isArray(bots.json.available_bots));
    assert.ok(bots.json.available_bots.some((bot) => bot.bot_key === 'uk-de' && bot.is_connected === true));
  });
});

test('miniapp mutation endpoints validate input and persist profile changes', async () => {
  await withMockedQuery(createMiniappQueryHandler(), async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const token = signSession({ chatId: 42, username: 'alice', botKey: 'uk-de' });
    const authHeaders = { Authorization: `Bearer ${token}` };

    const badCurrency = await request(app, {
      method: 'POST',
      path: '/me/preferences/billing-currency',
      headers: authHeaders,
      body: { currency: 'ABC' }
    });
    assert.equal(badCurrency.status, 400);
    assert.equal(badCurrency.json.error, 'bad_currency');

    const billingCurrency = await request(app, {
      method: 'POST',
      path: '/me/preferences/billing-currency',
      headers: authHeaders,
      body: { currency: 'CHF' }
    });
    assert.equal(billingCurrency.status, 200);
    assert.equal(billingCurrency.json.preferred_billing_currency, 'CHF');

    const badFeedback = await request(app, {
      method: 'POST',
      path: '/me/feedbacks',
      headers: authHeaders,
      body: { category: 'unknown', message: 'Hello' }
    });
    assert.equal(badFeedback.status, 400);
    assert.equal(badFeedback.json.error, 'bad_feedback_category');

    const feedback = await request(app, {
      method: 'POST',
      path: '/me/feedbacks',
      headers: authHeaders,
      body: { category: 'idea', message: 'Need more drills' }
    });
    assert.equal(feedback.status, 201);
    assert.equal(feedback.json.bot_key, 'uk-de');
    assert.equal(feedback.json.item.category, 'idea');
    assert.equal(feedback.json.item.text, 'Need more drills');

    const badLevel = await request(app, {
      method: 'POST',
      path: '/me/level',
      headers: authHeaders,
      body: { level: 'z9' }
    });
    assert.equal(badLevel.status, 400);
    assert.equal(badLevel.json.error, 'bad_level');

    const level = await request(app, {
      method: 'POST',
      path: '/me/level',
      headers: authHeaders,
      body: { level: 'b1' }
    });
    assert.equal(level.status, 200);
    assert.equal(level.json.user.bot_key, 'uk-de');
  });
});

test('internal topic menu renders only free-visible topics for free users', async () => {
  const sentMessages = [];

  await withMockedFetch(async (_url, init) => {
    sentMessages.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: 991 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, async () => {
    await withMockedQuery(async (source, params = []) => {
      if (source.includes('CASE') && source.includes('FROM users') && source.includes('effective_tier')) {
        return { rows: [{ effective_tier: 'free' }] };
      }

      if (source.includes('FROM user_bots') && source.includes('topic_pack_json')) {
        return { rows: [{ topic_enabled: false, topic_template_id: null, topic_pack_json: null }] };
      }

      if (source.includes('FROM bot_topic_catalog')) {
        assert.equal(params[0], 'uk-de');
        return {
          rows: [
            {
              bot_key: 'uk-de',
              topic_id: 'all-topic',
              emoji: '🧩',
              access_tier: 'all',
              title_base: 'All Topic',
              goal_base: 'All goal',
              allowed_base: ['one', 'two'],
              avoid_base: ['three', 'four'],
              starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
              recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'],
              sort_order: 10,
              created_at: null,
              updated_at: null
            },
            {
              bot_key: 'uk-de',
              topic_id: 'free-topic',
              emoji: '🌱',
              access_tier: 'free',
              title_base: 'Free Topic',
              goal_base: 'Free goal',
              allowed_base: ['one', 'two'],
              avoid_base: ['three', 'four'],
              starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
              recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'],
              sort_order: 20,
              created_at: null,
              updated_at: null
            },
            {
              bot_key: 'uk-de',
              topic_id: 'pro-topic',
              emoji: '🔒',
              access_tier: 'pro',
              title_base: 'Pro Topic',
              goal_base: 'Pro goal',
              allowed_base: ['one', 'two'],
              avoid_base: ['three', 'four'],
              starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
              recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'],
              sort_order: 30,
              created_at: null,
              updated_at: null
            }
          ]
        };
      }

      throw new Error(`Unexpected query in internal topics menu test: ${source.slice(0, 160)}`);
    }, async () => {
      const app = await createApp({ apiBoss: { publish: async () => null } });
      const response = await request(app, {
        method: 'POST',
        path: '/internal/topics/menu',
        headers: { 'X-Internal-Secret': 'internal-secret' },
        body: { chat_id: 42, bot_key: 'uk-de' }
      });

      assert.equal(response.status, 200);
      assert.equal(response.json.ok, true);
      assert.equal(response.json.count, 2);
      assert.equal(sentMessages.length, 1);
      assert.deepEqual(
        sentMessages[0].reply_markup.inline_keyboard.map((row) => row[0].callback_data),
        ['topic:all-topic', 'topic:free-topic', 'topic:clear']
      );
    });
  });
});
