import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/test_db';
process.env.WEBAPP_URL ??= 'https://example.test/app';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_123';
process.env.JWT_SECRET ??= 'jwt_secret_for_tests';
process.env.ADMIN_DASHBOARD_PASSWORD ??= 'secret-admin';
process.env.INTERNAL_API_SECRET ??= 'internal-secret';
process.env.SENTRY_DSN ??= 'https://public@example.ingest.sentry.io/1';
process.env.SENTRY_TEST_MODE ??= '1';

const [{ pool }, jobsModule] = await Promise.all([
  import('../src/db.js'),
  import('../src/jobs.js')
]);
const {
  __getCapturedEventsForTests,
  __resetCapturedEventsForTests,
  ensureSentryInitialized
} = await import('../src/sentry.js');
const { env } = await import('../src/env.js');

ensureSentryInitialized({ processName: 'worker' });

const {
  sendAdminTestDay1ReturnReminder,
  sendAdminTestIdiomPracticeReminder,
  sendIdiomPracticeMorePhrase,
  sendAdminTestWeeklyDigestReminder,
  sendDay1ReturnReminderCore,
  sendIdiomPracticeReminderCore,
  sendWeeklyDigestReminderCore
} = jobsModule;

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

function okTelegramResponse(messageId = 777) {
  return new Response(
    JSON.stringify({
      ok: true,
      result: { message_id: messageId }
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

test('admin day1 return reminder uses topic + voice variants without language mention', async () => {
  const queries = [];
  const telegramBodies = [];

  await withMockedQuery(async (source, params = []) => {
    queries.push(source);

    if (source.includes('FROM users u') && source.includes('LEFT JOIN bot_onboarding_completion onboarding')) {
      assert.equal(params[0], 42);
      assert.equal(params[1], 'en-de');
      return {
        rows: [{
          chat_id: 42,
          first_name: 'Alice',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          reply_mode: 'voice',
          topic_enabled: true,
          topic_pack_json: { title: 'coffee chat' },
          last_seen_at: '2026-03-10T08:00:00.000Z',
          onboarding_sent_at: '2026-03-10T09:00:00.000Z'
        }]
      };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE user_bots')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE users')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in admin day1 return test: ${source.slice(0, 180)}`);
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(901);
    }, async () => {
      const result = await sendAdminTestDay1ReturnReminder({
        chatId: 42,
        botKey: 'en-de'
      });

      assert.equal(result.ok, true);
      assert.equal(result.reminder_type, 'day1_return');
      assert.equal(result.telegram_message_id, 901);
      assert.match(result.message_text, /coffee chat/i);
      assert.match(result.message_text, /voice note/i);
      assert.doesNotMatch(result.message_text, /\bin german\b/i);
      assert.doesNotMatch(result.message_text, /\bin italian\b/i);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /coffee chat/i);
  assert.match(telegramBodies[0].text, /voice note/i);
  assert.equal(queries.filter((sql) => sql.includes('INSERT INTO scheduled_task_dispatches')).length, 1);
});

test('admin idiom practice reminder sends one translated phrase', async () => {
  const telegramBodies = [];
  const deliveredPhraseIds = [];

  await withMockedQuery(async (source, params = []) => {
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

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('SELECT id') && source.includes('FROM scheduled_task_dispatches')) {
      return { rows: [{ id: 9011 }] };
    }

    if (source.includes('WITH candidates AS (')) {
      assert.equal(params[2], 'uk');
      assert.equal(params[3], 'en');
      assert.equal(params[4], 'a1_a2');
      assert.match(String(params[5]), /^manual_test:/);
      assert.equal(params[6], 1);
      return {
        rows: [
          {
            id: 101,
            phrase_text: 'For what it\'s worth',
            meaning_text: 'This may or may not be useful, but here is my opinion.',
            tone_text: 'careful',
            example_text: 'For what it\'s worth, I think your first idea was better.',
            phrase_translation: 'Якщо це має значення',
            meaning_translation: 'Це може бути корисно або ні, але ось моя думка.',
            tone_translation: 'обережний',
            example_translation: 'Якщо це має значення, я думаю, що твоя перша ідея була кращою.',
            delivery_count: 0,
            last_sent_at: null
          },
          {
            id: 102,
            phrase_text: 'That figures',
            meaning_text: 'That makes sense in a slightly negative or unsurprised way.',
            tone_text: 'casual',
            example_text: 'The train is late again? That figures.',
            phrase_translation: 'Цього і слід було чекати',
            meaning_translation: 'Це логічно, хоч і трохи негативно або без здивування.',
            tone_translation: 'невимушений',
            example_translation: 'Потяг знову запізнюється? Цього і слід було чекати.',
            delivery_count: 1,
            last_sent_at: '2026-03-18T09:00:00.000Z'
          }
        ]
      };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE user_bots')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('INSERT INTO idiom_phrase_deliveries')) {
      deliveredPhraseIds.push(...params[3]);
      return { rowCount: params[3].length, rows: [] };
    }

    if (source.includes('UPDATE users')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in admin idiom practice test: ${source.slice(0, 180)}`);
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(933);
    }, async () => {
      const result = await sendAdminTestIdiomPracticeReminder({
        chatId: 55,
        botKey: 'uk-en'
      });

      assert.equal(result.ok, true);
      assert.equal(result.reminder_type, 'idiom_phrase_practice');
      assert.equal(result.telegram_message_id, 933);
      assert.deepEqual(result.phrase_ids, [101]);
      assert.match(result.message_text, /For what it's worth/);
      assert.match(result.message_text, /Якщо це має значення/);
      assert.match(result.message_text, /🗣/u);
      assert.match(result.message_text, /💡/u);
      assert.match(result.message_text, /📝/u);
      assert.match(result.message_text, /<i>\(/);
      assert.match(result.message_text, /Надішли власне речення/i);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /For what it's worth/);
  assert.match(telegramBodies[0].text, /🗣/u);
  assert.match(telegramBodies[0].text, /📝/u);
  assert.doesNotMatch(telegramBodies[0].text, /\b2\./);
  assert.equal(telegramBodies[0].reply_markup.inline_keyboard[0][0].text, 'Покажи ще одну фразу');
  assert.match(
    telegramBodies[0].reply_markup.inline_keyboard[0][0].callback_data,
    /^idiom_more:manual_test:/
  );
  assert.ok(telegramBodies[0].reply_markup.inline_keyboard[0][0].callback_data.length <= 64);
  assert.deepEqual(deliveredPhraseIds, [101]);
});

test('automated idiom practice still sends without onboarding and after same-day practice', async () => {
  const now = new Date('2026-03-28T10:00:00.000Z');
  const telegramBodies = [];
  const deliveredPhraseIds = [];

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM users u') && source.includes('practiced_today')) {
      return {
        rows: [{
          chat_id: 88,
          first_name: 'Lena',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          level: 'b1',
          onboarding_sent_at: null,
          practiced_today: true
        }]
      };
    }

    if (source.includes('SELECT 1') && source.includes('FROM scheduled_task_dispatches')) {
      return { rows: [] };
    }

    if (source.includes('FROM feedback_replies')) {
      return { rows: [] };
    }

    if (source.includes('FROM action_events')) {
      return { rows: [] };
    }

    if (source.includes('FROM broadcast_recipients')) {
      return { rows: [] };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('SELECT id') && source.includes('FROM scheduled_task_dispatches')) {
      return { rows: [{ id: 9022 }] };
    }

    if (source.includes('SELECT COUNT(*)::int AS delivery_count') && source.includes('FROM idiom_phrase_deliveries')) {
      assert.equal(params[2], '2026-03-28T00:00:00.000Z');
      assert.equal(params[3], '2026-03-29T00:00:00.000Z');
      return { rows: [{ delivery_count: 0 }] };
    }

    if (source.includes('WITH candidates AS (')) {
      assert.equal(params[2], 'en');
      assert.equal(params[3], 'de');
      assert.equal(params[4], 'b1_b2');
      assert.equal(params[5], '2026-03-28T00:00:00.000Z');
      assert.equal(params[6], '2026-03-29T00:00:00.000Z');
      assert.equal(params[7], 1);
      assert.match(source, /ORDER BY\s+delivery_count ASC,\s+RANDOM\(\)/);
      return {
        rows: [{
          id: 201,
          phrase_text: 'Cut to the chase',
          meaning_text: 'Get to the main point quickly.',
          tone_text: 'direct',
          example_text: 'Let me cut to the chase: we need an answer today.',
          phrase_translation: 'Komm zur Sache',
          meaning_translation: 'Komm schnell zum Hauptpunkt.',
          tone_translation: 'direkt',
          example_translation: 'Kommen wir zur Sache: Wir brauchen heute eine Antwort.',
          delivery_count: 0,
          last_sent_at: null
        }]
      };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE user_bots')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('INSERT INTO idiom_phrase_deliveries')) {
      deliveredPhraseIds.push(...params[3]);
      return { rowCount: params[3].length, rows: [] };
    }

    if (source.includes('UPDATE users')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in automated idiom practice send test: ${source.slice(0, 180)}`);
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(944);
    }, async () => {
      const result = await sendIdiomPracticeReminderCore({
        chatId: 88,
        botKey: 'en-de',
        scheduleKey: '2026-03-28:h07',
        now
      });

      assert.equal(result.ok, true);
      assert.equal(result.telegramMessageId, 944);
      assert.deepEqual(result.phraseIds, [201]);
      assert.equal(result.scheduleKey, '2026-03-28:h07');
      assert.match(result.messageText, /Cut to the chase/);
      assert.match(result.messageText, /Komm zur Sache/);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.equal(telegramBodies[0].reply_markup.inline_keyboard[0][0].callback_data, 'idiom_more:2026-03-28:h07');
  assert.deepEqual(deliveredPhraseIds, [201]);
});

test('idiom practice more reserves capacity for the evening automatic phrase', async () => {
  const now = new Date('2026-03-28T17:01:00.000Z');
  const scheduleKey = '2026-03-28:h07';
  const telegramBodies = [];
  const actionEvents = [];
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
  let nextMessageId = 934;

  const contextQueryHandler = async (source, params = []) => {
    if (source.includes('FROM users u') && source.includes('practiced_today')) {
      assert.equal(params[0], 55);
      assert.equal(params[1], 'uk-en');
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
      actionEvents.push({ source, params });
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected pool query in idiom more test: ${source.slice(0, 180)}`);
  };

  const connectHandler = () => ({
    async query(sql, params = []) {
      const source = typeof sql === 'string' ? sql : sql?.text || '';
      if (source === 'BEGIN' || source === 'COMMIT' || source === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (source.includes('INSERT INTO action_events (')) {
        return { rowCount: 1, rows: [] };
      }
      if (source.includes('SELECT id, telegram_message_id, payload_json') && source.includes('FOR UPDATE')) {
        assert.equal(params[3], scheduleKey);
        return { rows: [dispatch] };
      }
      if (source.includes('SELECT COUNT(*)::int AS delivery_count') && source.includes('AND sent_at >=')) {
        return { rows: [{ delivery_count: deliveredPhraseIds.length }] };
      }
      if (source.includes('WITH candidates AS (')) {
        assert.equal(params[2], 'uk');
        assert.equal(params[3], 'en');
        assert.equal(params[4], 'a1_a2');
        assert.equal(params[5], '2026-03-28T00:00:00.000Z');
        assert.equal(params[6], '2026-03-29T00:00:00.000Z');
        assert.equal(params[7], 1);
        const candidates = [
          {
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
          },
          {
            id: 103,
            phrase_text: 'Cut to the chase',
            meaning_text: 'Get to the main point quickly.',
            tone_text: 'direct',
            example_text: 'Let me cut to the chase: we need an answer today.',
            phrase_translation: 'Перейти до суті',
            meaning_translation: 'Швидко перейти до головного.',
            tone_translation: 'прямий',
            example_translation: 'Перейду до суті: нам потрібна відповідь сьогодні.',
            delivery_count: 0,
            last_sent_at: null
          }
        ];
        return {
          rows: candidates.filter((row) => !deliveredPhraseIds.includes(row.id)).slice(0, 1)
        };
      }
      if (source.includes('INSERT INTO idiom_phrase_deliveries')) {
        deliveredPhraseIds.push(...params[3]);
        return { rowCount: params[3].length, rows: [] };
      }
      if (source.includes('FROM public.grant_xp(')) {
        assert.equal(params[2], 'btn_idiom_more');
        assert.equal(params[3], 2);
        return {
          rows: [{
            applied: true,
            awarded_xp: 2,
            xp_total: 42,
            xp_daily: 8,
            streak_current: 3,
            streak_best: 5,
            streak_last_day: '2026-03-28',
            level: 1,
            xp_into_level: 42,
            xp_to_next: 158
          }]
        };
      }
      if (source.includes('UPDATE scheduled_task_dispatches') && source.includes('SET payload_json =')) {
        dispatch.payload_json = JSON.parse(params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (source.includes('UPDATE action_events')) {
        actionEvents.push({ source, params });
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected client query in idiom more test: ${source.slice(0, 180)}`);
    },
    release() {}
  });

  await withMockedPool({
    queryHandler: contextQueryHandler,
    connectHandler
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(nextMessageId++);
    }, async () => {
      const first = await sendIdiomPracticeMorePhrase({
        chatId: 55,
        botKey: 'uk-en',
        scheduleKey,
        callbackQueryId: 'cb-1',
        sourceMessageId: 933,
        now
      });
      assert.equal(first.status, 'delivered');
      assert.equal(first.deliveryIndex, 2);
      assert.equal(first.callbackText, 'Надсилаю ще одну фразу.');
      assert.equal(first.telegramMessageId, 934);

      const second = await sendIdiomPracticeMorePhrase({
        chatId: 55,
        botKey: 'uk-en',
        scheduleKey,
        callbackQueryId: 'cb-2',
        sourceMessageId: 934,
        now
      });
      assert.equal(second.status, 'limit_reached');
      assert.equal(second.deliveryIndex, null);
      assert.equal(second.callbackText, '');
      assert.equal(second.telegramMessageId, 935);
    });
  });

  assert.equal(telegramBodies.length, 2);
  assert.match(telegramBodies[0].text, /That figures/);
  assert.equal(telegramBodies[0].reply_markup, undefined);
  assert.match(telegramBodies[1].text, /Ти вже використав сьогоднішній ліміт ідіом\./);
  assert.equal(telegramBodies[1].reply_markup, undefined);
  assert.deepEqual(deliveredPhraseIds, [101, 102]);
  assert.deepEqual(dispatch.payload_json.phrase_ids, [101, 102]);
  assert.deepEqual(dispatch.payload_json.idiom_message_ids, [933, 934]);
});

test('idiom practice more accepts dashboard test schedules', async () => {
  const scheduleKey = 'manual_test:2026-03-28T10:00:00.000Z:test-run';
  const telegramBodies = [];
  const dispatch = {
    id: 9012,
    telegram_message_id: 933,
    payload_json: {
      phrase_ids: [101],
      idiom_message_ids: [933],
      delivery_count: 1
    }
  };
  const deliveredPhraseIds = [101];

  await withMockedPool({
    queryHandler: async (source, params = []) => {
      if (source.includes('FROM users u') && source.includes('practiced_today')) {
        assert.equal(params[0], 55);
        assert.equal(params[1], 'uk-en');
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
      throw new Error(`Unexpected pool query in manual idiom more test: ${source.slice(0, 180)}`);
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
          assert.equal(params[0], 'idiom_phrase_practice_test');
          assert.equal(params[1], 'uk-en');
          assert.equal(params[2], 55);
          assert.equal(params[3], scheduleKey);
          return { rows: [dispatch] };
        }
        if (source.includes('SELECT COUNT(*)::int AS delivery_count') && source.includes('FROM idiom_phrase_deliveries')) {
          return { rows: [{ delivery_count: deliveredPhraseIds.length }] };
        }
        if (source.includes('WITH candidates AS (')) {
          assert.equal(params[2], 'uk');
          assert.equal(params[3], 'en');
          assert.equal(params[4], 'a1_a2');
          assert.equal(params[5], scheduleKey);
          assert.equal(params[6], 1);
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
          return { rowCount: params[3].length, rows: [] };
        }
        if (source.includes('FROM public.grant_xp(')) {
          assert.equal(params[2], 'btn_idiom_more');
          assert.equal(params[3], 2);
          return {
            rows: [{
              applied: true,
              awarded_xp: 2,
              xp_total: 24,
              xp_daily: 6,
              streak_current: 2,
              streak_best: 4,
              streak_last_day: '2026-03-28',
              level: 1,
              xp_into_level: 24,
              xp_to_next: 176
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
        throw new Error(`Unexpected client query in manual idiom more test: ${source.slice(0, 180)}`);
      },
      release() {}
    })
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(934);
    }, async () => {
      const result = await sendIdiomPracticeMorePhrase({
        chatId: 55,
        botKey: 'uk-en',
        scheduleKey,
        callbackQueryId: 'cb-manual',
        sourceMessageId: 933,
        now: new Date('2026-03-28T10:00:00.000Z')
      });

      assert.equal(result.status, 'delivered');
      assert.equal(result.deliveryIndex, 2);
      assert.equal(result.callbackText, 'Надсилаю ще одну фразу.');
      assert.equal(result.telegramMessageId, 934);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /That figures/);
  assert.equal(telegramBodies[0].reply_markup.inline_keyboard[0][0].callback_data, `idiom_more:${scheduleKey}`);
  assert.deepEqual(deliveredPhraseIds, [101, 102]);
  assert.deepEqual(dispatch.payload_json.phrase_ids, [101, 102]);
  assert.deepEqual(dispatch.payload_json.idiom_message_ids, [933, 934]);
});

test('idiom practice more accepts old buttons and uses today quota', async () => {
  const now = new Date('2026-03-28T10:00:00.000Z');
  const telegramBodies = [];
  const dispatch = {
    id: 9013,
    telegram_message_id: 933,
    payload_json: {
      phrase_ids: [101],
      idiom_message_ids: [933],
      delivery_count: 1
    }
  };
  const deliveredPhraseIds = [101];

  await withMockedPool({
    queryHandler: async (source, params = []) => {
      if (source.includes('FROM users u') && source.includes('practiced_today')) {
        assert.equal(params[0], 55);
        assert.equal(params[1], 'uk-en');
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
      throw new Error(`Unexpected pool query in old idiom button test: ${source.slice(0, 180)}`);
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
          assert.equal(params[0], 'idiom_phrase_practice');
          assert.equal(params[1], 'uk-en');
          assert.equal(params[2], 55);
          assert.equal(params[3], '2026-03-28');
          return { rows: [dispatch] };
        }
        if (source.includes('SELECT COUNT(*)::int AS delivery_count') && source.includes('AND sent_at >=')) {
          return { rows: [{ delivery_count: deliveredPhraseIds.length }] };
        }
        if (source.includes('WITH candidates AS (')) {
          assert.equal(params[2], 'uk');
          assert.equal(params[3], 'en');
          assert.equal(params[4], 'a1_a2');
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
          assert.equal(params[4], '2026-03-28');
          return { rowCount: params[3].length, rows: [] };
        }
        if (source.includes('FROM public.grant_xp(')) {
          assert.equal(params[2], 'btn_idiom_more');
          assert.equal(params[3], 2);
          return {
            rows: [{
              applied: true,
              awarded_xp: 2,
              xp_total: 42,
              xp_daily: 8,
              streak_current: 3,
              streak_best: 5,
              streak_last_day: '2026-03-28',
              level: 1,
              xp_into_level: 42,
              xp_to_next: 158
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
        throw new Error(`Unexpected client query in old idiom button test: ${source.slice(0, 180)}`);
      },
      release() {}
    })
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(934);
    }, async () => {
      const result = await sendIdiomPracticeMorePhrase({
        chatId: 55,
        botKey: 'uk-en',
        scheduleKey: '2026-03-27',
        callbackQueryId: 'cb-old',
        sourceMessageId: 933,
        now
      });

      assert.equal(result.status, 'delivered');
      assert.equal(result.callbackText, 'Надсилаю ще одну фразу.');
      assert.equal(result.deliveryIndex, 2);
      assert.equal(result.telegramMessageId, 934);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /That figures/);
  assert.equal(telegramBodies[0].reply_markup, undefined);
  assert.deepEqual(dispatch.payload_json.phrase_ids, [101, 102]);
  assert.deepEqual(dispatch.payload_json.idiom_message_ids, [933, 934]);
});

test('automated day1 return sends generic text after 22 hours of inactivity', async () => {
  const telegramBodies = [];

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM users u') && source.includes('LEFT JOIN bot_onboarding_completion onboarding')) {
      return {
        rows: [{
          chat_id: 77,
          first_name: 'Bob',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          reply_mode: 'text',
          topic_enabled: false,
          topic_pack_json: null,
          last_seen_at: '2026-03-09T08:00:00.000Z',
          onboarding_sent_at: new Date(Date.now() - (23 * 60 * 60 * 1000)).toISOString()
        }]
      };
    }

    if (source.includes('FROM scheduled_task_dispatches') && source.includes("AND status = 'sent'") && source.includes('LIMIT 1')) {
      if (params[0] === 'day1_return') {
        return { rows: [] };
      }
      return { rows: [] };
    }

    if (source.includes('FROM feedback_replies')) {
      return { rows: [] };
    }

    if (source.includes('FROM broadcast_recipients')) {
      return { rows: [] };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE user_bots')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE users')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in automated day1 return success test: ${source.slice(0, 180)}`);
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(902);
    }, async () => {
      const result = await sendDay1ReturnReminderCore({
        chatId: 77,
        botKey: 'en-de'
      });

      assert.equal(result.ok, true);
      assert.equal(result.taskType, 'day1_return');
      assert.equal(result.telegramMessageId, 902);
      assert.ok([
        'Have 2 minutes for practice? Write one short sentence.',
        'Want to get back into practice? Write one short sentence.'
      ].includes(result.messageText));
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.doesNotMatch(telegramBodies[0].text, /\bin german\b/i);
  assert.doesNotMatch(telegramBodies[0].text, /\bin italian\b/i);
});

test('automated day1 return skips when user was active after onboarding', async () => {
  let telegramCalled = false;

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM users u') && source.includes('LEFT JOIN bot_onboarding_completion onboarding')) {
      return {
        rows: [{
          chat_id: 91,
          first_name: 'Cara',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          reply_mode: 'text',
          topic_enabled: false,
          topic_pack_json: null,
          last_seen_at: '2026-03-10T12:00:00.000Z',
          onboarding_sent_at: '2026-03-10T09:00:00.000Z'
        }]
      };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in automated day1 return skip test: ${source.slice(0, 180)}`);
  }, async () => {
    await withMockedFetch(async () => {
      telegramCalled = true;
      return okTelegramResponse(903);
    }, async () => {
      const result = await sendDay1ReturnReminderCore({
        chatId: 91,
        botKey: 'en-de'
      });

      assert.equal(result, null);
    });
  });

  assert.equal(telegramCalled, false);
});

test('admin weekly digest reminder falls back to localized templates when LLM is unavailable', async () => {
  const telegramBodies = [];
  __resetCapturedEventsForTests();

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('COALESCE(up.streak_current, 0)::int AS streak_current') && source.includes('COALESCE(week_stats.weekly_xp, 0)::int AS weekly_xp')) {
      assert.equal(params[0], 55);
      assert.equal(params[1], 'en-de');
      return {
        rows: [{
          chat_id: 55,
          first_name: 'Nina',
          username: 'nina',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          level: 'a2',
          reply_mode: 'text',
          topic_enabled: true,
          topic_pack_json: { title: 'coffee chat' },
          last_seen_at: '2026-03-09T10:00:00.000Z',
          xp_total: 480,
          streak_current: 3,
          streak_best: 5,
          profile_summary: 'Enjoys travel topics',
          short_summary: 'Prefers short replies',
          onboarding_sent_at: '2026-03-01T09:00:00.000Z',
          weekly_xp: 118,
          practice_days: 4
        }]
      };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE user_bots')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE users')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in admin weekly digest test: ${source.slice(0, 200)}`);
  }, async () => {
    await withMockedFetch(async (_url, init) => {
      telegramBodies.push(JSON.parse(init.body));
      return okTelegramResponse(904);
    }, async () => {
      const result = await sendAdminTestWeeklyDigestReminder({
        chatId: 55,
        botKey: 'en-de'
      });

      assert.equal(result.ok, true);
      assert.equal(result.reminder_type, 'weekly_digest');
      assert.equal(result.telegram_message_id, 904);
      assert.match(result.message_text, /\b118\b/);
      assert.match(result.message_text, /\b4\b/);
      assert.match(result.message_text, /coffee chat/i);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /\b118\b/);
  assert.match(telegramBodies[0].text, /\b4\b/);
  const events = __getCapturedEventsForTests();
  assert.ok(events.some((event) =>
    event?.message === 'weekly_digest_llm_fallback'
    && event?.extra?.chat_id === 55
    && event?.tags?.subsystem === 'weekly-digest'
    && event?.tags?.reminder_type === 'weekly_digest'
    && event?.tags?.generation_error === 'missing_openai_api_key'
  ));
});

test('automated weekly digest skips users active in the last 8 hours', async () => {
  let telegramCalled = false;

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('COALESCE(up.streak_current, 0)::int AS streak_current') && source.includes('COALESCE(week_stats.weekly_xp, 0)::int AS weekly_xp')) {
      return {
        rows: [{
          chat_id: 88,
          first_name: 'Lena',
          username: 'lena',
          inactive_reason: null,
          bot_key: 'en-de',
          is_active: true,
          level: 'b1',
          reply_mode: 'text',
          topic_enabled: false,
          topic_pack_json: null,
          last_seen_at: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
          xp_total: 620,
          streak_current: 2,
          streak_best: 7,
          profile_summary: '',
          short_summary: '',
          onboarding_sent_at: '2026-03-01T09:00:00.000Z',
          weekly_xp: 76,
          practice_days: 3
        }]
      };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in automated weekly digest skip test: ${source.slice(0, 200)}`);
  }, async () => {
    await withMockedFetch(async () => {
      telegramCalled = true;
      return okTelegramResponse(905);
    }, async () => {
      const result = await sendWeeklyDigestReminderCore({
        chatId: 88,
        botKey: 'en-de'
      });

      assert.equal(result, null);
    });
  });

  assert.equal(telegramCalled, false);
});

test('admin weekly digest reads structured Responses API output when output_text is empty', async () => {
  const originalOpenAiKey = env.openaiApiKey;
  const telegramBodies = [];
  env.openaiApiKey = 'test-openai-key';

  try {
    await withMockedQuery(async (source, params = []) => {
      if (source.includes('COALESCE(up.streak_current, 0)::int AS streak_current') && source.includes('COALESCE(week_stats.weekly_xp, 0)::int AS weekly_xp')) {
        assert.equal(params[0], 56);
        assert.equal(params[1], 'en-de');
        return {
          rows: [{
            chat_id: 56,
            first_name: 'Mira',
            username: 'mira',
            inactive_reason: null,
            bot_key: 'en-de',
            is_active: true,
            level: 'a2',
            reply_mode: 'text',
            topic_enabled: false,
            topic_pack_json: null,
            last_seen_at: '2026-03-09T10:00:00.000Z',
            xp_total: 510,
            streak_current: 2,
            streak_best: 6,
            profile_summary: 'Likes short practical prompts',
            short_summary: 'Consistent learner',
            onboarding_sent_at: '2026-03-01T09:00:00.000Z',
            weekly_xp: 118,
            practice_days: 4
          }]
        };
      }

      if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
        return { rowCount: 1, rows: [] };
      }

      if (source.includes('UPDATE scheduled_task_dispatches')) {
        return { rowCount: 1, rows: [] };
      }

      if (source.includes('UPDATE user_bots')) {
        return { rowCount: 1, rows: [] };
      }

      if (source.includes('UPDATE users')) {
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query in structured weekly digest test: ${source.slice(0, 200)}`);
    }, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (typeof url === 'string' && url.startsWith('https://api.openai.com/')) {
          const requestBody = JSON.parse(init.body);
          assert.equal(requestBody.model, env.reminderLlmModel);
          assert.deepEqual(requestBody.reasoning, { effort: env.reminderLlmReasoningEffort });
          return new Response(
            JSON.stringify({
              id: 'resp_test_1',
              model: 'gpt-5-mini',
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({
                        message_text: 'Last week: 4 practice days, 118 XP. Write one short sentence and let\'s continue.'
                      })
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (typeof url === 'string' && url.startsWith('https://api.telegram.org/')) {
          telegramBodies.push(JSON.parse(init.body));
          return okTelegramResponse(906);
        }
        return originalFetch(input, init);
      };

      try {
        const result = await sendAdminTestWeeklyDigestReminder({
          chatId: 56,
          botKey: 'en-de'
        });

        assert.equal(result.ok, true);
        assert.equal(result.telegram_message_id, 906);
        assert.equal(result.message_source, 'llm');
        assert.equal(result.generation_error, null);
        assert.equal(result.llm_response_id, 'resp_test_1');
        assert.match(result.message_text, /\b118\b/);
        assert.match(result.message_text, /\b4\b/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assert.equal(telegramBodies.length, 1);
    assert.match(telegramBodies[0].text, /\b118\b/);
    assert.match(telegramBodies[0].text, /\b4\b/);
  } finally {
    env.openaiApiKey = originalOpenAiKey;
  }
});
