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
    if (source.includes("reply_kbd_topic_click") && source.includes('GROUP BY d.day_utc')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      assert.deepEqual(params[4], [
        'reply_kbd_topic_click',
        'reply_kbd_level_click',
        'reply_kbd_voice_click',
        'reply_kbd_xp_click',
        'idiom_phrase_more_click'
      ]);
      return {
        rows: [
          {
            day: '2026-03-01',
            reply_kbd_topic_click: 4,
            reply_kbd_level_click: 2,
            reply_kbd_voice_click: 6,
            reply_kbd_xp_click: 1,
            idiom_phrase_more_click: 3
          },
          {
            day: '2026-03-02',
            reply_kbd_topic_click: 3,
            reply_kbd_level_click: 0,
            reply_kbd_voice_click: 5,
            reply_kbd_xp_click: 2,
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
        reply_kbd_topic_click: 4,
        reply_kbd_level_click: 2,
        reply_kbd_voice_click: 6,
        reply_kbd_xp_click: 1,
        idiom_phrase_more_click: 3
      },
      {
        day: '2026-03-02',
        reply_kbd_topic_click: 3,
        reply_kbd_level_click: 0,
        reply_kbd_voice_click: 5,
        reply_kbd_xp_click: 2,
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
        'reply_kbd_topic_click',
        'reply_kbd_level_click',
        'reply_kbd_voice_click',
        'reply_kbd_xp_click',
        'idiom_phrase_more_click'
      ]);
      return {
        rows: [
          {
            action: 'reply_kbd_topic_click',
            clicks: 7,
            unique_users: 5,
            total_clicks: 23,
            summary_unique_users: 11
          },
          {
            action: 'reply_kbd_level_click',
            clicks: 2,
            unique_users: 2,
            total_clicks: 23,
            summary_unique_users: 11
          },
          {
            action: 'reply_kbd_voice_click',
            clicks: 8,
            unique_users: 6,
            total_clicks: 23,
            summary_unique_users: 11
          },
          {
            action: 'reply_kbd_xp_click',
            clicks: 2,
            unique_users: 2,
            total_clicks: 23,
            summary_unique_users: 11
          },
          {
            action: 'idiom_phrase_more_click',
            clicks: 4,
            unique_users: 3,
            total_clicks: 23,
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
      total_clicks: 23,
      unique_users: 11
    });
    assert.deepEqual(response.json.series, [
      { action: 'reply_kbd_topic_click', clicks: 7, unique_users: 5 },
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
          if (source.includes('SELECT COUNT(*)::int AS delivery_count')) {
            return { rows: [{ delivery_count: deliveredPhraseIds.length }] };
          }
          if (source.includes('WITH candidates AS (')) {
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
  assert.equal(telegramBodies[0].reply_markup.inline_keyboard[0][0].callback_data, 'idiom_more:2026-03-28');
});

test('admin xp button click metrics return daily click counts', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes("btn_translation") && source.includes('GROUP BY d.day_utc')) {
      assert.equal(params[0], '2026-03-01T00:00:00.000Z');
      assert.equal(params[1], '2026-03-04T00:00:00.000Z');
      assert.equal(params[2], null);
      assert.equal(params[3], null);
      assert.deepEqual(params[4], ['btn_translation', 'btn_vocab', 'btn_hints']);
      return {
        rows: [
          {
            day: '2026-03-01',
            btn_translation: 5,
            btn_vocab: 2,
            btn_hints: 3
          },
          {
            day: '2026-03-02',
            btn_translation: 1,
            btn_vocab: 4,
            btn_hints: 0
          }
        ]
      };
    }

    throw new Error(`Unexpected query in admin xp button clicks by day test: ${source.slice(0, 180)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      path: '/admin/metrics/xp-button-clicks-by-day?from=2026-03-01&to=2026-03-04',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.tz, 'UTC');
    assert.equal(response.json.from, '2026-03-01T00:00:00.000Z');
    assert.equal(response.json.to, '2026-03-04T00:00:00.000Z');
    assert.deepEqual(response.json.series, [
      {
        day: '2026-03-01',
        btn_translation: 5,
        btn_vocab: 2,
        btn_hints: 3
      },
      {
        day: '2026-03-02',
        btn_translation: 1,
        btn_vocab: 4,
        btn_hints: 0
      }
    ]);
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
      assert.deepEqual(params[4], ['first_voice_sent', 'free_limit_half', 'paywall_shown']);
      assert.match(source, /e\.occurred_at < \$2::timestamptz/);
      assert.match(source, /std\.sent_at < \$2::timestamptz/);
      assert.match(source, /paywall_shown_at >= free_limit_half_at/);
      assert.ok(!source.includes('FROM usage_hourly'));
      return {
        rows: [{
          start_count: 20,
          first_message_count: 11,
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
      { action: 'first_message', count: 11, pct: 55 },
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
    assert.equal(bossCalls[0][0], 'discord-event-send');
    assert.equal(bossCalls[0][1].type, 'user_feedback');
    assert.equal(bossCalls[0][1].feedback_id, 77);
    assert.equal(bossCalls[0][1].category, 'idea');
    assert.equal(bossCalls[0][1].feedback_text, 'Need more drills');

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

test('internal topic menu renders all topics and marks pro topics for free users', async () => {
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
      assert.equal(response.json.count, 3);
      assert.equal(sentMessages.length, 1);
      assert.deepEqual(
        sentMessages[0].reply_markup.inline_keyboard.map((row) => row[0].callback_data),
        ['topic:all-topic', 'topic:free-topic', 'topic:pro-topic', 'topic:clear']
      );
      assert.equal(sentMessages[0].reply_markup.inline_keyboard[2][0].text, '🔒 Pro Topic 🔒 PRO');
    });
  });
});

test('internal topic menu marks pro topics with an open lock for pro users', async () => {
  const sentMessages = [];

  await withMockedFetch(async (_url, init) => {
    sentMessages.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: 992 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, async () => {
    await withMockedQuery(async (source, params = []) => {
      if (source.includes('CASE') && source.includes('FROM users') && source.includes('effective_tier')) {
        return { rows: [{ effective_tier: 'pro' }] };
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

      throw new Error(`Unexpected query in internal topics menu pro badge test: ${source.slice(0, 160)}`);
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
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].reply_markup.inline_keyboard[0][0].text, '🔒 Pro Topic ✅ PRO');
    });
  });
});

test('internal n8n error notification queues a Discord event', async () => {
  const bossCalls = [];
  const app = await createApp({
    apiBoss: {
      send: async (...args) => {
        bossCalls.push(args);
        return 'job-123';
      }
    }
  });

  const response = await request(app, {
    method: 'POST',
    path: '/internal/notifications/n8n-error',
    headers: { 'X-Internal-Secret': 'internal-secret' },
    body: {
      execution_id: '987',
      workflow_name: 'AI Bot',
      workflow_id: 'wf_1',
      error_message: 'Node execution failed',
      last_node: 'HTTP Request',
      mode: 'trigger'
    }
  });

  assert.equal(response.status, 202);
  assert.deepEqual(response.json, { ok: true, queued: true });
  assert.equal(bossCalls.length, 1);
  assert.equal(bossCalls[0][0], 'discord-event-send');
  assert.equal(bossCalls[0][1].type, 'n8n_execution_error');
  assert.equal(bossCalls[0][1].execution_id, '987');
  assert.equal(bossCalls[0][2].singletonKey, 'discord_event:n8n_execution_error:987');
});

test('admin topics list returns v2 topic fields', async () => {
  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM bot_topic_catalog')) {
      assert.equal(params[0], 'uk-de');
      return {
        rows: [
          {
            bot_key: 'uk-de',
            topic_id: 'coffee',
            emoji: '☕',
            access_tier: 'all',
            title_base: 'Coffee shop',
            goal_base: 'Practice a short cafe order.',
            allowed_base: ['ordering drinks', 'asking for milk'],
            subareas_json: [
              { id: 'drink-type', label_base: 'ordering drinks', keywords_target: ['coffee'], keywords_base: ['ordering drinks'] },
              { id: 'milk', label_base: 'asking for milk', keywords_target: ['milk'], keywords_base: ['asking for milk'] }
            ],
            avoid_base: ['politics', 'weather'],
            starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
            recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'],
            sort_order: 10,
            created_at: null,
            updated_at: null,
            topic_mode: 'roleplay',
            speech_acts_base: ['ordering', 'clarifying'],
            lexical_anchors_target: ['latte', 'oat milk'],
            grammar_targets_json: { tense: ['present simple'] },
            starter_questions_by_level_target: { default: ['Q1?'], a1: ['A1 starter?'] },
            recovery_questions_by_level_target: { default: ['R1?'] },
            bridge_patterns_target: ['How about...'],
            hard_block_base: ['politics'],
            soft_redirect_base: ['weather'],
            opening_prompt_target: 'Do you want a latte or cappuccino?'
          }
        ]
      };
    }

    throw new Error(`Unexpected query in admin topics list test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      method: 'GET',
      path: '/admin/topics?bot_key=uk-de',
      headers: { 'X-Admin-Password': 'secret-admin' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.selected_bot_key, 'uk-de');
    assert.equal(response.json.items.length, 1);
    assert.equal(response.json.items[0].topic_mode, 'roleplay');
    assert.equal(response.json.items[0].subareas_json.length, 2);
    assert.equal(response.json.items[0].opening_prompt_target, 'Do you want a latte or cappuccino?');
    assert.deepEqual(response.json.items[0].lexical_anchors_target, ['latte', 'oat milk']);
    assert.deepEqual(response.json.items[0].starter_questions_by_level_target, {
      default: ['Q1?'],
      a1: ['A1 starter?']
    });
  });
});

test('admin topic update preserves existing v2 fields when legacy form omits them', async () => {
  const existingRow = {
    bot_key: 'uk-de',
    topic_id: 'coffee',
    emoji: '☕',
    access_tier: 'all',
    title_base: 'Coffee shop',
    goal_base: 'Practice a short cafe order.',
    allowed_base: ['ordering drinks', 'asking for milk'],
    subareas_json: [
      { id: 'drink-type', label_base: 'ordering drinks', keywords_target: ['coffee'], keywords_base: ['ordering drinks'] },
      { id: 'milk', label_base: 'asking for milk', keywords_target: ['milk'], keywords_base: ['asking for milk'] }
    ],
    avoid_base: ['politics', 'weather'],
    starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
    recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?'],
    sort_order: 10,
    created_at: null,
    updated_at: null,
    topic_mode: 'roleplay',
    speech_acts_base: ['ordering', 'clarifying'],
    lexical_anchors_target: ['latte', 'oat milk'],
    grammar_targets_json: { tense: ['present simple'] },
    starter_questions_by_level_target: { default: ['Q1?'], a1: ['A1 starter?'] },
    recovery_questions_by_level_target: { default: ['R1?'] },
    bridge_patterns_target: ['How about...'],
    hard_block_base: ['politics'],
    soft_redirect_base: ['weather'],
    opening_prompt_target: 'Do you want a latte or cappuccino?'
  };

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM bot_topic_catalog') && source.includes('LIMIT 1')) {
      assert.deepEqual(params, ['uk-de', 'coffee']);
      return { rows: [existingRow] };
    }

    if (source.includes('UPDATE bot_topic_catalog')) {
      assert.equal(params[0], 'uk-de');
      assert.equal(params[1], 'coffee');
      assert.equal(params[2], 'coffee');
      assert.equal(params[8], JSON.stringify(existingRow.subareas_json));
      assert.equal(params[12], 'roleplay');
      assert.equal(params[13], JSON.stringify(['ordering', 'clarifying']));
      assert.equal(params[14], JSON.stringify(['latte', 'oat milk']));
      assert.equal(params[15], JSON.stringify({ tense: ['present simple'] }));
      assert.equal(params[16], JSON.stringify({ default: ['Q1?'], a1: ['A1 starter?'] }));
      assert.equal(params[17], JSON.stringify({ default: ['R1?'] }));
      assert.equal(params[18], JSON.stringify(['How about...']));
      assert.equal(params[19], JSON.stringify(['politics']));
      assert.equal(params[20], JSON.stringify(['weather']));
      assert.equal(params[21], 'Do you want a latte or cappuccino?');
      return {
        rows: [
          {
            ...existingRow,
            title_base: params[5],
            goal_base: params[6],
            allowed_base: JSON.parse(params[7]),
            subareas_json: JSON.parse(params[8]),
            avoid_base: JSON.parse(params[9]),
            starter_questions_target: JSON.parse(params[10]),
            recovery_questions_target: JSON.parse(params[11]),
            sort_order: params[22]
          }
        ]
      };
    }

    throw new Error(`Unexpected query in admin topic update test: ${source.slice(0, 160)}`);
  }, async () => {
    const app = await createApp({ apiBoss: { publish: async () => null } });
    const response = await request(app, {
      method: 'PUT',
      path: '/admin/topics/coffee',
      headers: { 'X-Admin-Password': 'secret-admin' },
      body: {
        bot_key: 'uk-de',
        topic_id: 'coffee',
        emoji: '☕',
        access_tier: 'all',
        title_base: 'Coffee shop updated',
        goal_base: 'Practice updated cafe orders.',
        allowed_base: ['ordering drinks', 'asking about desserts'],
        avoid_base: ['politics', 'religion'],
        starter_questions_target: ['New Q1?', 'New Q2?', 'New Q3?', 'New Q4?', 'New Q5?', 'New Q6?'],
        recovery_questions_target: ['New R1?', 'New R2?', 'New R3?', 'New R4?', 'New R5?', 'New R6?'],
        sort_order: 12
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.item.title_base, 'Coffee shop updated');
    assert.equal(response.json.item.topic_mode, 'roleplay');
    assert.equal(response.json.item.subareas_json.length, 2);
    assert.equal(response.json.item.opening_prompt_target, 'Do you want a latte or cappuccino?');
    assert.deepEqual(response.json.item.lexical_anchors_target, ['latte', 'oat milk']);
    assert.deepEqual(response.json.item.bridge_patterns_target, ['How about...']);
  });
});
