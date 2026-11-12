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
process.env.SENTRY_DSN ??= 'https://public@example.ingest.sentry.io/1';
process.env.SENTRY_TEST_MODE ??= '1';
process.env.DISCORD_EVENTS_WEBHOOK_URL ??= 'https://discord.test/api/webhooks/123';

const [{ createApp }, { pool }, { signSession }, { httpError }, sentryModule] = await Promise.all([
  import('../src/app.js'),
  import('../src/db.js'),
  import('../src/auth.js'),
  import('../src/core/errors.js'),
  import('../src/sentry.js')
]);
const {
  __getCapturedEventsForTests,
  __resetCapturedEventsForTests,
  captureException,
  flushSentry
} = sentryModule;

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

async function withMockedPool({ queryHandler = null, connectHandler = null }, run) {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  if (queryHandler) {
    pool.query = async (sql, params) => queryHandler(typeof sql === 'string' ? sql : sql?.text || '', params);
  }
  if (connectHandler) {
    pool.connect = async () => connectHandler();
  }
  try {
    await run();
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
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
  let lastFeedback = null;
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
      throw new Error('unexpected_xp_query');
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
      lastFeedback = {id:77, created_at:'2026-03-11T09:00:00.000Z', feedback_text:params[5], category:params[10]};
      assert.ok(source.includes('INSERT INTO feedback_notifications'));
      assert.ok(source.includes('INSERT INTO feedback_threads'));
      return {rows:[{id:'77',duplicate:false}]};
    }
    if (source.startsWith('SELECT id, created_at, feedback_text, category FROM feedback')) {
      return {rows:lastFeedback?[lastFeedback]:[]};
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

test('admin manual PRO override grants and updates an inclusive UTC expiry date', async () => {
  let updateCount = 0;
  await withMockedQuery(async (source, params = []) => {
    assert.match(source, /SET override_plan_tier = 'pro'/);
    assert.match(source, /override_expires_at = \$2::timestamptz/);
    assert.match(source, /THEN 'manual'/);
    assert.equal(params[0], '42');
    updateCount += 1;

    const expected = updateCount === 1
      ? ['2099-07-31', '2099-08-01T00:00:00.000Z']
      : ['2099-08-15', '2099-08-16T00:00:00.000Z'];
    assert.equal(params[1], expected[1]);
    return {
      rows: [{
        chat_id: '42',
        override_plan_tier: 'pro',
        override_expires_at: expected[1],
        override_expires_on: expected[0],
        effective_tier: 'pro',
        tier_source: 'manual'
      }]
    };
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const headers = { 'X-Admin-Password': 'secret-admin' };

    const granted = await request(app, {
      method: 'PUT',
      path: '/admin/users/42/plan-override',
      headers,
      body: { tier: 'pro', expires_on: '2099-07-31' }
    });
    assert.equal(granted.status, 200);
    assert.equal(granted.json.ok, true);
    assert.equal(granted.json.effective_tier, 'pro');
    assert.equal(granted.json.tier_source, 'manual');
    assert.equal(granted.json.override_expires_on, '2099-07-31');
    assert.equal(granted.json.override_expires_at, '2099-08-01T00:00:00.000Z');

    const extended = await request(app, {
      method: 'PUT',
      path: '/admin/users/42/plan-override',
      headers,
      body: { tier: 'pro', expires_on: '2099-08-15' }
    });
    assert.equal(extended.status, 200);
    assert.equal(extended.json.override_expires_on, '2099-08-15');
  });

  assert.equal(updateCount, 2);
});

test('admin manual PRO override rejects invalid requests before querying the database', async () => {
  await withMockedQuery(async (source) => {
    throw new Error(`Unexpected query for invalid manual PRO request: ${source.slice(0, 120)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const headers = { 'X-Admin-Password': 'secret-admin' };
    const cases = [
      { path: '/admin/users/0/plan-override', body: { tier: 'pro', expires_on: '2099-07-31' }, error: 'bad_chat_id' },
      { path: '/admin/users/42/plan-override', body: { tier: 'plus', expires_on: '2099-07-31' }, error: 'bad_tier' },
      { path: '/admin/users/42/plan-override', body: { tier: 'pro', expires_on: '31-07-2099' }, error: 'bad_expires_on' },
      { path: '/admin/users/42/plan-override', body: { tier: 'pro', expires_on: '2099-02-30' }, error: 'bad_expires_on' },
      { path: '/admin/users/42/plan-override', body: { tier: 'pro', expires_on: '2000-01-01' }, error: 'expires_on_elapsed' }
    ];

    for (const item of cases) {
      const response = await request(app, {
        method: 'PUT',
        path: item.path,
        headers,
        body: item.body
      });
      assert.equal(response.status, 400);
      assert.equal(response.json.error, item.error);
    }
  });
});

test('admin manual PRO override returns 404 when the target user is missing', async () => {
  await withMockedQuery(async (source, params = []) => {
    assert.match(source, /SET override_plan_tier = 'pro'/);
    assert.deepEqual(params, ['999', '2099-08-01T00:00:00.000Z']);
    return { rows: [] };
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      method: 'PUT',
      path: '/admin/users/999/plan-override',
      headers: { 'X-Admin-Password': 'secret-admin' },
      body: { tier: 'pro', expires_on: '2099-07-31' }
    });

    assert.equal(response.status, 404);
    assert.equal(response.json.error, 'user_not_found');
  });
});

test('admin manual PRO override revocation is idempotent and exposes the underlying subscription', async () => {
  let revokeCount = 0;
  await withMockedQuery(async (source, params = []) => {
    assert.match(source, /SET override_plan_tier = NULL/);
    assert.match(source, /override_expires_at = NULL/);
    assert.match(source, /THEN 'subscription'/);
    assert.deepEqual(params, ['42']);
    revokeCount += 1;
    return {
      rows: [{
        chat_id: '42',
        override_plan_tier: null,
        override_expires_at: null,
        override_expires_on: null,
        effective_tier: 'pro',
        tier_source: 'subscription'
      }]
    };
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const headers = { 'X-Admin-Password': 'secret-admin' };

    for (let index = 0; index < 2; index += 1) {
      const response = await request(app, {
        method: 'DELETE',
        path: '/admin/users/42/plan-override',
        headers
      });
      assert.equal(response.status, 200);
      assert.equal(response.json.effective_tier, 'pro');
      assert.equal(response.json.tier_source, 'subscription');
      assert.equal(response.json.override_expires_at, null);
    }
  });

  assert.equal(revokeCount, 2);
});

test('admin user deletion matches the current schema and includes LLM telemetry', async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(source, params = []) {
      const normalized = source.replace(/\s+/g, ' ').trim();
      statements.push(normalized);

      if (normalized === 'BEGIN' || normalized === 'COMMIT') return { rowCount: 0, rows: [] };

      const tableMatch = normalized.match(/^DELETE FROM ([a-z_]+) WHERE chat_id = \$1::bigint$/);
      assert.ok(tableMatch, `Unexpected query in admin user deletion test: ${normalized}`);
      assert.deepEqual(params, [8719088547]);

      const tableName = tableMatch[1];
      if (tableName === 'llm_call_events') return { rowCount: 2, rows: [] };
      if (tableName === 'users') return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() {
      released = true;
    }
  };

  await withMockedPool({ connectHandler: async () => client }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      method: 'POST',
      path: '/admin/users/delete',
      headers: { 'X-Admin-Password': 'secret-admin' },
      body: { chatId: '8719088547' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.chat_id, 8719088547);
    assert.equal(response.json.deleted_total, 3);
    assert.equal(response.json.deleted.llm_call_events, 2);
    assert.equal(response.json.deleted.users, 1);
  });

  const executedTables = statements
    .map((source) => source.match(/^DELETE FROM ([a-z_]+)/)?.[1])
    .filter(Boolean);
  assert.ok(executedTables.includes('llm_call_events'));
  assert.ok(!executedTables.includes('usage_week'));
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(released, true);
});

test('admin user directory returns effective tier source and active manual expiry', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('SELECT COUNT(*)::int AS total') && source.includes('FROM directory_filtered')) {
      assert.match(source, /ELSE COALESCE\(all_bot_activity\.is_active, false\)/);
      assert.deepEqual(params, [
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]);
      return { rows: [{ total: 1 }] };
    }

    if (source.includes('activity_days AS')) {
      assert.match(source, /d\.tier_source/);
      assert.match(source, /WHEN d\.tier_source = 'manual' THEN d\.override_expires_at/);
      assert.match(source, /END AS override_expires_on/);
      assert.deepEqual(params, [
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        50,
        0
      ]);
      return {
        rows: [{
          chat_id: '42',
          username: 'alice',
          first_name: 'Alice',
          bot_key: 'uk-de',
          created_at: '2026-07-10T12:00:00.000Z',
          last_seen_at: '2026-07-12T12:00:00.000Z',
          is_active: true,
          effective_tier: 'pro',
          tier_source: 'manual',
          override_expires_at: '2026-08-01T00:00:00.000Z',
          override_expires_on: '2026-07-31',
          streak_days: 3,
          xp_total: 220,
          level: 2
        }]
      };
    }

    throw new Error(`Unexpected query in admin user directory test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/users?from=2026-07-01&to=2026-08-01',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.total, 1);
    assert.equal(response.json.items[0].effective_tier, 'pro');
    assert.equal(response.json.items[0].tier_source, 'manual');
    assert.equal(response.json.items[0].override_expires_on, '2026-07-31');
  });
});

test('admin user directory defaults to all created dates when from and to are omitted', async () => {
  let queryCount = 0;
  await withMockedQuery(async (source, params = []) => {
    queryCount += 1;
    assert.match(source, /\$1::timestamptz IS NULL OR u\.created_at >= \$1::timestamptz/);
    assert.match(source, /\$2::timestamptz IS NULL OR u\.created_at < \$2::timestamptz/);
    assert.equal(params[0], null);
    assert.equal(params[1], null);

    if (source.includes('SELECT COUNT(*)::int AS total')) {
      assert.deepEqual(params, [null, null, null, null, null, null, null, null, null]);
      return { rows: [{ total: 1 }] };
    }

    assert.match(source, /\$1::timestamptz IS NULL OR v\.occurred_at >= \$1::timestamptz/);
    assert.match(source, /\$2::timestamptz IS NULL OR m\.created_at < \$2::timestamptz/);
    assert.deepEqual(params, [null, null, null, null, null, null, null, null, null, 50, 0]);
    return {
      rows: [{
        chat_id: '42',
        username: 'alice',
        first_name: 'Alice',
        bot_key: 'uk-de',
        created_at: '2024-01-10T12:00:00.000Z',
        last_seen_at: '2026-07-12T12:00:00.000Z',
        is_active: true,
        effective_tier: 'free',
        tier_source: 'free',
        override_expires_at: null,
        override_expires_on: null,
        streak_days: 3,
        xp_total: 220,
        level: 2
      }]
    };
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/users',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.from, null);
    assert.equal(response.json.to, null);
    assert.equal(response.json.total, 1);
    assert.equal(response.json.items[0].created_at, '2024-01-10T12:00:00.000Z');
  });
  assert.equal(queryCount, 2);
});

test('admin user directory applies combined search and bot-context filters to count and page queries', async () => {
  let queryCount = 0;
  await withMockedQuery(async (source, params = []) => {
    queryCount += 1;
    assert.match(source, /u\.username ILIKE/);
    assert.match(source, /u\.first_name ILIKE/);
    assert.match(source, /u\.chat_id::text LIKE/);
    assert.match(source, /AND \(\$5::text IS NULL OR b\.bot_key = \$5::text\)/);
    assert.match(source, /WHEN \$5::text IS NOT NULL THEN COALESCE\(bot_context\.is_active, false\)/);
    assert.match(source, /\$8::timestamptz IS NULL OR last_seen_at >= \$8::timestamptz/);
    assert.match(source, /\$9::timestamptz IS NULL OR last_seen_at < \$9::timestamptz/);

    const expectedFilters = [
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      'campaign-a',
      'ali',
      'uk-de',
      'pro',
      true,
      '2026-07-05T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z'
    ];

    if (source.includes('SELECT COUNT(*)::int AS total')) {
      assert.deepEqual(params, expectedFilters);
      return { rows: [{ total: 1 }] };
    }

    assert.match(source, /ORDER BY last_seen_at ASC NULLS LAST, d\.chat_id DESC/);
    assert.deepEqual(params, [...expectedFilters, 25, 50]);
    return {
      rows: [{
        chat_id: '42',
        username: 'alice',
        first_name: 'Alice',
        bot_key: 'uk-de',
        created_at: '2026-07-10T12:00:00.000Z',
        last_seen_at: '2026-07-12T12:00:00.000Z',
        is_active: true,
        effective_tier: 'pro',
        tier_source: 'subscription',
        override_expires_at: null,
        override_expires_on: null,
        streak_days: 3,
        xp_total: 220,
        level: 2
      }]
    };
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/users?from=2026-07-01&to=2026-08-01&payload=campaign-a&q=%40ali&bot_key=uk-de&tier=pro&active=true&last_seen_from=2026-07-05&last_seen_to=2026-07-12&limit=25&offset=50&sort_key=last_seen_at&sort_dir=asc',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.total, 1);
    assert.equal(response.json.q, 'ali');
    assert.equal(response.json.bot_key, 'uk-de');
    assert.equal(response.json.tier, 'pro');
    assert.equal(response.json.active, true);
    assert.equal(response.json.last_seen_from, '2026-07-05');
    assert.equal(response.json.last_seen_to, '2026-07-12');
  });
  assert.equal(queryCount, 2);
});

test('admin user directory rejects invalid filter values before querying the database', async () => {
  await withMockedQuery(async (source) => {
    throw new Error(`Unexpected query for invalid users filter: ${source.slice(0, 120)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const cases = [
      { query: 'bot_key=missing-bot', error: 'bad_bot_key' },
      { query: 'tier=plus', error: 'bad_tier' },
      { query: 'active=yes', error: 'bad_active' },
      { query: 'last_seen_from=2026-02-30', error: 'bad_last_seen_date' },
      { query: 'last_seen_from=2026-07-14&last_seen_to=2026-07-12', error: 'bad_last_seen_range' }
    ];

    for (const item of cases) {
      const response = await request(app, {
        path: `/admin/users?from=2026-07-01&to=2026-08-01&${item.query}`,
        headers: { 'X-Admin-Password': 'secret-admin' }
      });
      assert.equal(response.status, 400);
      assert.equal(response.json.error, item.error);
    }
  });
});

test('admin notifications metrics returns sent counts by bot and type', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM scheduled_task_dispatches std') && source.includes('FROM broadcast_recipients r')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      return {
        rows: [
          { day: '2026-03-01', bot_key: 'uk-de', notification_type: 'onboarding_complete', count: 2 },
          { day: '2026-03-01', bot_key: 'uk-de', notification_type: 'broadcast_text', count: 3 },
          { day: '2026-03-02', bot_key: 'uk-en', notification_type: 'winback_d3', count: 1 },
          { day: '2026-03-03', bot_key: 'en-de', notification_type: 'weekly_digest', count: 4 },
          { day: '2026-03-03', bot_key: 'uk-en', notification_type: 'idiom_phrase_practice', count: 2 }
        ]
      };
    }

    throw new Error(`Unexpected query in admin notifications metrics test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/notifications-by-day?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { day: '2026-03-01', bot_key: 'uk-de', notification_type: 'onboarding_complete', count: 2 },
      { day: '2026-03-01', bot_key: 'uk-de', notification_type: 'broadcast_text', count: 3 },
      { day: '2026-03-02', bot_key: 'uk-en', notification_type: 'winback_d3', count: 1 },
      { day: '2026-03-03', bot_key: 'en-de', notification_type: 'weekly_digest', count: 4 },
      { day: '2026-03-03', bot_key: 'uk-en', notification_type: 'idiom_phrase_practice', count: 2 }
    ]);
  });
});

test('admin reply keyboard click metrics return daily click counts', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes("reply_kbd_level_click") && source.includes('GROUP BY d.day_utc')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      assert.deepEqual(params[4], [
        'reply_kbd_level_click',
        'reply_kbd_voice_click',

        'idiom_phrase_more_click'
      ]);
      return {
        rows: [
          {
            day: '2026-03-01',
            reply_kbd_level_click: 2,
            reply_kbd_voice_click: 6,
            idiom_phrase_more_click: 3
          },
          {
            day: '2026-03-02',
            reply_kbd_level_click: 0,
            reply_kbd_voice_click: 5,
            idiom_phrase_more_click: 1
          }
        ]
      };
    }

    throw new Error(`Unexpected query in admin reply keyboard clicks by day test: ${source.slice(0, 180)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/reply-keyboard-clicks-by-day?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      {
        day: '2026-03-01',
        reply_kbd_level_click: 2,
        reply_kbd_voice_click: 6,
        idiom_phrase_more_click: 3
      },
      {
        day: '2026-03-02',
        reply_kbd_level_click: 0,
        reply_kbd_voice_click: 5,
        idiom_phrase_more_click: 1
      }
    ]);
  });
});

test('admin reply keyboard click totals return clicks and unique users', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('filtered_events AS') && source.includes('summary_unique_users')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      assert.deepEqual(params[4], [
        'reply_kbd_level_click',
        'reply_kbd_voice_click',

        'idiom_phrase_more_click'
      ]);
      return {
        rows: [
          {
            action: 'reply_kbd_level_click',
            clicks: 2,
            unique_users: 2,
            total_clicks: 16,
            summary_unique_users: 11
          },
          {
            action: 'reply_kbd_voice_click',
            clicks: 8,
            unique_users: 6,
            total_clicks: 16,
            summary_unique_users: 11
          },
          {
            action: 'reply_kbd_xp_click',
            clicks: 2,
            unique_users: 2,
            total_clicks: 16,
            summary_unique_users: 11
          },
          {
            action: 'idiom_phrase_more_click',
            clicks: 4,
            unique_users: 3,
            total_clicks: 16,
            summary_unique_users: 11
          }
        ]
      };
    }

    throw new Error(`Unexpected query in admin reply keyboard click totals test: ${source.slice(0, 180)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/reply-keyboard-click-totals?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.summary, {
      total_clicks: 16,
      unique_users: 11
    });
    assert.deepEqual(response.json.series, [
      { action: 'reply_kbd_level_click', clicks: 2, unique_users: 2 },
      { action: 'reply_kbd_voice_click', clicks: 8, unique_users: 6 },
      { action: 'reply_kbd_xp_click', clicks: 2, unique_users: 2 },
      { action: 'idiom_phrase_more_click', clicks: 4, unique_users: 3 }
    ]);
  });
});

test('internal idiom practice more returns delivered result', async () => {
  const now = new Date('2026-03-28T10:00:00.000Z');
  const RealDate = Date;
  const telegramBodies = [];
  const dispatch = {
    id: 9011,
    telegram_message_id: 933,
    payload_json: {
      phrase_ids: [101],
      idiom_message_ids: [933],
      delivery_count: 1
    }
  };
  const deliveredPhraseIds = [101];

  globalThis.Date = class extends RealDate {
    constructor(value) {
      super(value ?? now.toISOString());
    }
    static now() {
      return now.getTime();
    }
    static parse(value) {
      return RealDate.parse(value);
    }
    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  };

  try {
    await withMockedPool({
      queryHandler: async (source, params = []) => {
        if (source.includes('FROM users u') && source.includes('practiced_today')) {
          return {
            rows: [{
              chat_id: 55,
              first_name: 'Oksana',
              inactive_reason: null,
              bot_key: 'uk-en',
              is_active: true,
              level: 'a2',
              onboarding_sent_at: '2026-03-10T09:00:00.000Z',
              practiced_today: false
            }]
          };
        }
        if (source.includes('INSERT INTO action_events (')) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected pool query in internal idiom more test: ${source.slice(0, 180)}`);
      },
      connectHandler: () => ({
        async query(sql, params = []) {
          const source = typeof sql === 'string' ? sql : sql?.text || '';
          if (source === 'BEGIN' || source === 'COMMIT' || source === 'ROLLBACK') {
            return { rowCount: 0, rows: [] };
          }
          if (source.includes('INSERT INTO action_events (')) {
            return { rowCount: 1, rows: [] };
          }
          if (source.includes('SELECT id, telegram_message_id, payload_json') && source.includes('FOR UPDATE')) {
            return { rows: [dispatch] };
          }
          if (source.includes('SELECT COUNT(*)::int AS delivery_count') && source.includes('AND sent_at >=')) {
            return { rows: [{ delivery_count: deliveredPhraseIds.length }] };
          }
          if (source.includes('WITH candidates AS (')) {
            assert.equal(params[5], '2026-03-28T00:00:00.000Z');
            assert.equal(params[6], '2026-03-29T00:00:00.000Z');
            assert.equal(params[7], 1);
            return {
              rows: [{
                id: 102,
                phrase_text: 'That figures',
                meaning_text: 'That makes sense in a slightly negative way.',
                tone_text: 'casual',
                example_text: 'The train is late again? That figures.',
                phrase_translation: 'Цього і слід було чекати',
                meaning_translation: 'Це логічно, хоч і трохи негативно.',
                tone_translation: 'невимушений',
                example_translation: 'Потяг знову запізнюється? Цього і слід було чекати.',
                delivery_count: 0,
                last_sent_at: null
              }]
            };
          }
          if (source.includes('INSERT INTO idiom_phrase_deliveries')) {
            deliveredPhraseIds.push(...params[3]);
            return { rowCount: 1, rows: [] };
          }
          if (source.includes('FROM public.grant_xp(')) {
            assert.equal(params[2], 'btn_idiom_more');
            assert.equal(params[3], 2);
            return {
              rows: [{
                applied: true,
                awarded_xp: 2,
                xp_total: 12,
                xp_daily: 4,
                streak_current: 2,
                streak_best: 2,
                streak_last_day: '2026-03-28',
                level: 1,
                xp_into_level: 12,
                xp_to_next: 188
              }]
            };
          }
          if (source.includes('UPDATE scheduled_task_dispatches') && source.includes('SET payload_json =')) {
            dispatch.payload_json = JSON.parse(params[1]);
            return { rowCount: 1, rows: [] };
          }
          if (source.includes('UPDATE action_events')) {
            return { rowCount: 1, rows: [] };
          }
          throw new Error(`Unexpected client query in internal idiom more test: ${source.slice(0, 180)}`);
        },
        release() {}
      })
    }, async () => {
      await withMockedFetch(async (_url, init) => {
        telegramBodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 934 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }, async () => {
        const app = await createApp({ apiBoss: { publish: async () => null } });
        const response = await request(app, {
          method: 'POST',
          path: '/internal/idiom-practice/more',
          headers: { 'X-Internal-Secret': 'internal-secret' },
          body: {
            chat_id: 55,
            bot_key: 'uk-en',
            schedule_key: '2026-03-28',
            callback_query_id: 'cb-1',
            source_message_id: 933
          }
        });

        assert.equal(response.status, 200);
        assert.equal(response.json.status, 'delivered');
        assert.equal(response.json.deliveryIndex, 2);
        assert.equal(response.json.telegramMessageId, 934);
      });
    });
  } finally {
    globalThis.Date = RealDate;
  }

  assert.equal(telegramBodies.length, 1);
  assert.equal(telegramBodies[0].reply_markup, undefined);
});

test('retired XP metric endpoints do not query the database', async () => {
  await withMockedQuery(async () => { throw new Error('unexpected_xp_query'); }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    for (const metric of ['xp-button-clicks-by-day', 'xp-earned-by-day', 'xp-distribution']) {
      const response = await request(app, {
        path: `/admin/metrics/${metric}?from=2026-03-01&to=2026-03-04`,
        headers: { 'X-Admin-Password': 'secret-admin' }
      });
      assert.equal(response.status, 404);
    }
  });
});

test('admin new paid users by day returns first-time paid users split by first associated bot', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('first_paid_users AS') && source.includes('CROSS JOIN (SELECT DISTINCT bot_key FROM counts) bots')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      return {
        rows: [
          { day: '2026-03-01', bot_key: 'uk-de', count: 2 },
          { day: '2026-03-01', bot_key: 'uk-en', count: 1 },
          { day: '2026-03-02', bot_key: 'uk-de', count: 0 },
          { day: '2026-03-02', bot_key: 'uk-en', count: 3 },
          { day: '2026-03-03', bot_key: 'uk-de', count: 1 },
          { day: '2026-03-03', bot_key: 'uk-en', count: 0 }
        ]
      };
    }

    throw new Error(`Unexpected query in admin new paid users test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/new-paid-by-day?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { day: '2026-03-01', bot_key: 'uk-de', count: 2 },
      { day: '2026-03-01', bot_key: 'uk-en', count: 1 },
      { day: '2026-03-02', bot_key: 'uk-de', count: 0 },
      { day: '2026-03-02', bot_key: 'uk-en', count: 3 },
      { day: '2026-03-03', bot_key: 'uk-de', count: 1 },
      { day: '2026-03-03', bot_key: 'uk-en', count: 0 }
    ]);
  });
});

test('admin action funnel uses in-window stage timestamps for sequential counts', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('WITH cohort AS') && source.includes('AS free_limit_half_at')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-08T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      assert.deepEqual(params[4], [
        'onboarding_scenario_selected',
        'onboarding_practice_sent',
        'free_limit_half',
        'paywall_shown'
      ]);
      assert.match(source, /e\.occurred_at < \$2::timestamptz/);
      assert.match(source, /completion\.completed_at < \$2::timestamptz/);
      assert.match(source, /paywall_shown_at >= free_limit_half_at/);
      assert.ok(!source.includes('FROM usage_hourly'));
      return {
        rows: [{
          start_count: 20,
          scenario_selected_count: 12,
          practice_sent_count: 11,
          onboarding_complete_count: 8,
          free_limit_half_count: 5,
          paywall_shown_count: 3
        }]
      };
    }

    throw new Error(`Unexpected query in admin action funnel test: ${source.slice(0, 180)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/action-funnel?from=2026-03-01&to=2026-03-08',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-08T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { action: 'start', count: 20, pct: 100 },
      { action: 'scenario_selected', count: 12, pct: 60 },
      { action: 'practice_sent', count: 11, pct: 55 },
      { action: 'onboarding_complete', count: 8, pct: 40 },
      { action: 'free_limit_half', count: 5, pct: 25 },
      { action: 'paywall_shown', count: 3, pct: 15 }
    ]);
  });
});

test('admin free users insights applies bot scope to all aggregates', async () => {
  let queryCount = 0;

  await withMockedQuery(async (source, params = []) => {
    assert.equal(params[0], '2026-03-01T00:00:00.000Z');
    assert.equal(params[1], '2026-03-04T00:00:00.000Z');
    assert.equal(params[2], null);
    assert.equal(params[3], null);
    assert.equal(params[4], 'uk-de');

    if (source.includes('free_users_with_voice_in_range') && source.includes('COUNT(*) FROM free_users')) {
      queryCount += 1;
      return {
        rows: [{
          free_users_all_time: 12,
          free_users_with_voice_in_range: 5,
          free_users_with_messages_in_range: 7,
          engaged_free_users_in_range: 8,
          in_seconds: 320,
          out_seconds: 180,
          sent_messages: 21,
          assistant_messages: 13
        }]
      };
    }

    if (source.includes("'<30s'::text") && source.includes('LEFT JOIN usage_per_user u ON true')) {
      queryCount += 1;
      return {
        rows: [
          { day: '<30s', users: 2 },
          { day: '<1m', users: 1 },
          { day: '<2m', users: 0 },
          { day: '<5m', users: 1 },
          { day: '<10m', users: 0 },
          { day: '10m+', users: 1 }
        ]
      };
    }

    if (source.includes("'31+'::text") && source.includes('LEFT JOIN message_per_user m ON true')) {
      queryCount += 1;
      return {
        rows: [
          { day: '1', users: 3 },
          { day: '2-3', users: 2 },
          { day: '4-7', users: 1 },
          { day: '8-15', users: 1 },
          { day: '16-30', users: 0 },
          { day: '31+', users: 0 }
        ]
      };
    }

    throw new Error(`Unexpected query in free users insights test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/free-users-insights?from=2026-03-01&to=2026-03-04&bot_key=uk-de',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.equal(response.json.bot_key, 'uk-de');
    assert.deepEqual(response.json.totals, {
      free_users_all_time: 12,
      free_users_with_voice_in_range: 5,
      free_users_with_messages_in_range: 7,
      engaged_free_users_in_range: 8,
      in_seconds: 320,
      out_seconds: 180,
      sent_messages: 21,
      assistant_messages: 13
    });
    assert.deepEqual(response.json.usage_buckets, [
      { day: '<30s', users: 2 },
      { day: '<1m', users: 1 },
      { day: '<2m', users: 0 },
      { day: '<5m', users: 1 },
      { day: '<10m', users: 0 },
      { day: '10m+', users: 1 }
    ]);
    assert.deepEqual(response.json.message_buckets, [
      { day: '1', users: 3 },
      { day: '2-3', users: 2 },
      { day: '4-7', users: 1 },
      { day: '8-15', users: 1 },
      { day: '16-30', users: 0 },
      { day: '31+', users: 0 }
    ]);
  });

  assert.equal(queryCount, 3);
});

test('admin active users by day returns first-day and returning user splits', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('first_activity AS') && source.includes('returned_users')) {
      assert.match(source, /FROM voice_usage_events v/);
      assert.match(source, /FROM messages m/);
      assert.doesNotMatch(source, /\b(xp_events|user_progress|grant_xp)\b/);
      assert.match(source, /FROM action_events a/);
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      return {
        rows: [
          { day: '2026-03-01', count: 5, new_users: 3, returned_users: 2 },
          { day: '2026-03-02', count: 4, new_users: 1, returned_users: 3 },
          { day: '2026-03-03', count: 0, new_users: 0, returned_users: 0 }
        ]
      };
    }

    throw new Error(`Unexpected query in active users by day test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/active-users-by-day?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { day: '2026-03-01', count: 5, new_users: 3, returned_users: 2 },
      { day: '2026-03-02', count: 4, new_users: 1, returned_users: 3 },
      { day: '2026-03-03', count: 0, new_users: 0, returned_users: 0 }
    ]);
  });
});

test('admin active users by day by bot counts any tracked activity with bot attribution', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('active-users-by-day-by-bot')) {
      throw new Error('route path leaked into SQL unexpectedly');
    }

    if (source.includes('COUNT(DISTINCT e.chat_id)::int AS count') && source.includes('CROSS JOIN (SELECT DISTINCT bot_key FROM counts) bots')) {
      assert.match(source, /FROM voice_usage_events v/);
      assert.match(source, /FROM messages m/);
      assert.doesNotMatch(source, /\b(xp_events|user_progress|grant_xp)\b/);
      assert.match(source, /FROM action_events a/);
      assert.match(source, /WHERE a\.bot_key IS NOT NULL/);
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      return {
        rows: [
          { day: '2026-03-01', bot_key: 'uk-de', count: 3 },
          { day: '2026-03-01', bot_key: 'en-de', count: 1 },
          { day: '2026-03-02', bot_key: 'uk-de', count: 2 },
          { day: '2026-03-02', bot_key: 'en-de', count: 0 },
          { day: '2026-03-03', bot_key: 'uk-de', count: 0 },
          { day: '2026-03-03', bot_key: 'en-de', count: 4 }
        ]
      };
    }

    throw new Error(`Unexpected query in active users by day by bot test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/active-users-by-day-by-bot?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { day: '2026-03-01', bot_key: 'uk-de', count: 3 },
      { day: '2026-03-01', bot_key: 'en-de', count: 1 },
      { day: '2026-03-02', bot_key: 'uk-de', count: 2 },
      { day: '2026-03-02', bot_key: 'en-de', count: 0 },
      { day: '2026-03-03', bot_key: 'uk-de', count: 0 },
      { day: '2026-03-03', bot_key: 'en-de', count: 4 }
    ]);
  });
});

test('admin active users by hour counts any tracked activity', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes("LPAD(h.hour_utc::text, 2, '0') || ':00' AS day")) {
      assert.match(source, /FROM voice_usage_events v/);
      assert.match(source, /FROM messages m/);
      assert.doesNotMatch(source, /\b(xp_events|user_progress|grant_xp)\b/);
      assert.match(source, /FROM action_events a/);
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      return {
        rows: [
          { day: '00:00', count: 0 },
          { day: '01:00', count: 2 },
          { day: '02:00', count: 5 }
        ]
      };
    }

    throw new Error(`Unexpected query in active users by hour test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/active-users-by-hour?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      { day: '00:00', count: 0 },
      { day: '01:00', count: 2 },
      { day: '02:00', count: 5 }
    ]);
  });
});

test('uncaught async route errors reach the final sentry-backed 500 handler', async () => {
  __resetCapturedEventsForTests();

  const app = await createApp({
    apiBoss: { publish: async () => null },
    configureApp: ({ app: expressApp }) => {
      expressApp.get('/__test/boom', async () => {
        throw new Error('boom');
      });
    }
  });

  const response = await request(app, { path: '/__test/boom' });
  await flushSentry(2000);

  assert.equal(response.status, 500);
  assert.equal(response.json.error, 'internal_server_error');
  assert.equal(typeof response.json.eventId, 'string');
});

test('http errors keep their payloads and are filtered out of sentry', async () => {
  __resetCapturedEventsForTests();

  const app = await createApp({
    apiBoss: { publish: async () => null },
    configureApp: ({ app: expressApp }) => {
      expressApp.get('/__test/http-error', async () => {
        throw httpError(400, 'bad_request', 'bad_request');
      });
    }
  });

  const response = await request(app, { path: '/__test/http-error' });
  await flushSentry(2000);

  assert.equal(response.status, 400);
  assert.deepEqual(response.json, { error: 'bad_request', detail: 'bad_request' });
  assert.equal(response.json.eventId, undefined);
  assert.equal(__getCapturedEventsForTests().length, 0);
});

test('directly captured handled 5xx errors are reported to sentry', async () => {
  __resetCapturedEventsForTests();
  await createApp({ apiBoss: { publish: async () => null } });

  const eventId = captureException(new Error('handled-route-failure'), {
    tags: { route: 'test-handled' }
  });
  await flushSentry(2000);

  assert.equal(typeof eventId, 'string');
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
    assert.equal('xp' in dashboard.json, false);
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
    const bossCalls = [];
    const app = await createApp({
      apiBoss: {
        publish: async () => null,
        send: async (...args) => {
          bossCalls.push(args);
          return 'job-feedback';
        }
      }
    });
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
    assert.equal(bossCalls.length, 1);
    assert.equal(bossCalls[0][0], 'feedback-notification-scan');
    assert.deepEqual(bossCalls[0][1], {}); // Payload lives durably in the shared outbox, not in a second notification producer.

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

test('internal prepare update returns route and keyboard state without side effects', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM user_bots ub') && source.includes('bot_onboarding_completion')) {
      assert.deepEqual(params, [42, 'uk-de']);
      return {
        rows: [{
          level: 'b1',
          reply_mode: 'text',
          onboarding_complete_at: '2026-03-11T08:00:00.000Z',
          xp_total: 640,
          xp_level: 4
        }]
      };
    }

    if (source.includes('FROM pending_feedback')) {
      assert.deepEqual(params, [42, 'uk-de']);
      return { rows: [{ pending: false }] };
    }

    throw new Error(`Unexpected query in internal prepare update test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: {
        bot_key: 'uk-de',
        telegram_update: {
          update_id: 987654,
          message: {
            message_id: 1234,
            text: '· 📚 B1',
            chat: { id: 42, type: 'private' },
            from: {
              id: 42,
              is_bot: false,
              username: 'alice',
              first_name: 'Alice',
              language_code: 'uk'
            }
          }
        }
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.contractVersion, 1);
    assert.equal(response.json.decisionId, 'v1:uk-de:987654');
    assert.equal(response.json.botKey, 'uk-de');
    assert.equal(response.json.updateId, 987654);
    assert.equal(response.json.route, 'command.unknown');
    assert.equal(response.json.input.chatId, 42);
    assert.equal(response.json.routingFacts.intentSource, 'reply_keyboard');
    assert.equal(response.json.routingFacts.keyboardIntent, 'retired');
    assert.equal(response.json.routingFacts.pendingFeedback, false);
    assert.match(response.json.context.keyboard.settingsButtonText, /⚙️/);
  });
});

test('internal prepare update rejects invalid updates and unknown bots before querying', async () => {
  await withMockedQuery(async (source) => {
    throw new Error(`Prepare validation must not query the database: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const invalidUpdate = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: {
        bot_key: 'uk-de',
        telegram_update: {
          message: {
            message_id: 1,
            text: 'missing update id',
            chat: { id: 42, type: 'private' },
            from: { id: 42, is_bot: false }
          }
        }
      }
    });
    assert.equal(invalidUpdate.status, 400);
    assert.deepEqual(invalidUpdate.json, { error: 'invalid_update' });

    const unknownBot = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: {
        botKey: 'missing-bot',
        telegramUpdate: {
          update_id: 123,
          message: {
            message_id: 1,
            text: 'unknown bot',
            chat: { id: 42, type: 'private' },
            from: { id: 42, is_bot: false }
          }
        }
      }
    });
    assert.equal(unknownBot.status, 400);
    assert.deepEqual(unknownBot.json, { error: 'unknown_bot' });
  });
});

test('internal prepare update emits bounded privacy-safe telemetry', async () => {
  const telemetry = [];
  const originalInfo = console.info;
  console.info = (event, fields, ...rest) => {
    if (event === 'internal-bot-prepare-update') {
      telemetry.push(fields);
      return;
    }
    originalInfo.call(console, event, fields, ...rest);
  };

  try {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const success = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: {
        bot_key: 'uk-de',
        telegram_update: {
          update_id: 7654321,
          message: {
            message_id: 1,
            text: 'sensitive-shadow-message',
            chat: { id: -10042, type: 'supergroup' },
            from: { id: 42, is_bot: false, first_name: 'Sensitive Name' }
          }
        }
      }
    });
    assert.equal(success.status, 200);

    const invalid = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: { bot_key: 'uk-de', telegram_update: null }
    });
    assert.equal(invalid.status, 400);
  } finally {
    console.info = originalInfo;
  }

  assert.equal(telemetry.length, 2);
  assert.deepEqual(Object.keys(telemetry[0]), [
    'contractVersion',
    'botKey',
    'route',
    'durationMs',
    'errorCode'
  ]);
  assert.deepEqual(
    { ...telemetry[0], durationMs: 0 },
    {
      contractVersion: 1,
      botKey: 'uk-de',
      route: 'guard.private_only',
      durationMs: 0,
      errorCode: null
    }
  );
  assert.deepEqual(
    { ...telemetry[1], durationMs: 0 },
    {
      contractVersion: 1,
      botKey: 'uk-de',
      route: null,
      durationMs: 0,
      errorCode: 'invalid_update'
    }
  );
  assert.equal(Number.isInteger(telemetry[0].durationMs), true);
  assert.equal(Number.isInteger(telemetry[1].durationMs), true);
  const serialized = JSON.stringify(telemetry);
  assert.equal(serialized.includes('sensitive-shadow-message'), false);
  assert.equal(serialized.includes('Sensitive Name'), false);
  assert.equal(serialized.includes('telegram_update'), false);
});

test('internal bot ingestion is dark by default and validates Contract v1', async () => {
  let sendCount = 0;
  await withMockedQuery(async (source) => {
    if (source.includes('FROM user_bots ub')) return { rows: [] };
    if (source.includes('FROM pending_feedback')) return { rows: [{ pending: false }] };
    throw new Error(`Unexpected ingestion test query: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({
      apiBoss: {
        async send() {
          sendCount += 1;
          return 'unexpected-job';
        }
      }
    });
    const prepared = await request(app, {
      method: 'POST',
      path: '/internal/bot/prepare-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: {
        bot_key: 'uk-en',
        telegram_update: {
          update_id: 7654999,
          message: {
            message_id: 1,
            text: '/stats',
            chat: { id: 42, type: 'private' },
            from: { id: 42, is_bot: false }
          }
        }
      }
    });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.json.route, 'command.unknown');

    const dark = await request(app, {
      method: 'POST',
      path: '/internal/bot/ingest-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: prepared.json
    });
    assert.equal(dark.status, 409);
    assert.deepEqual(dark.json, { accepted: false, error: 'route_not_enabled' });
    assert.equal(sendCount, 0);

    const invalid = await request(app, {
      method: 'POST',
      path: '/internal/bot/ingest-update',
      headers: { 'X-Internal-Secret': 'internal-secret' },
      body: { contractVersion: 1 }
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.json, { accepted: false, error: 'invalid_contract' });
  });
});

test('removed topic endpoints return 404 without database or Telegram side effects', async () => {
  await withMockedQuery(async (source) => {
    throw new Error(`Removed endpoint must not query the database: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    for (const [method, path] of [
      ['GET', '/admin/topics?bot_key=uk-de'],
      ['POST', '/admin/topics'],
      ['PUT', '/admin/topics/coffee'],
      ['DELETE', '/admin/topics/coffee?bot_key=uk-de'],
      ['POST', '/admin/topics/generate-draft'],
      ['POST', '/admin/topics/assist-draft'],
      ['POST', '/admin/topics/clone-to-bot'],
      ['GET', '/admin/metrics/topics-by-day'],
      ['POST', '/internal/topics/menu']
    ]) {
      const response = await request(app, {
        method, path,
        headers: { 'X-Admin-Password': 'secret-admin', 'X-Internal-Secret': 'internal-secret' },
        ...(method === 'POST' || method === 'PUT' ? { body: { bot_key: 'uk-de', chat_id: 42 } } : {})
      });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  });
});
