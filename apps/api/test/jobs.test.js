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

    if (source.includes('FROM users u') && source.includes('LEFT JOIN scheduled_task_dispatches onboarding')) {
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

test('admin idiom practice reminder sends translated phrase bundle', async () => {
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
      assert.equal(params[5], 2);
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
      assert.deepEqual(result.phrase_ids, [101, 102]);
      assert.match(result.message_text, /For what it's worth/);
      assert.match(result.message_text, /Якщо це має значення/);
      assert.match(result.message_text, /Надішли власне речення/i);
    });
  });

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0].text, /For what it's worth/);
  assert.match(telegramBodies[0].text, /Translation|Pereklad|Переклад/);
  assert.deepEqual(deliveredPhraseIds, [101, 102]);
});

test('automated idiom practice skips users who already practiced today', async () => {
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
          onboarding_sent_at: '2026-03-10T09:00:00.000Z',
          practiced_today: true
        }]
      };
    }

    if (source.includes('INSERT INTO scheduled_task_dispatches (')) {
      return { rowCount: 1, rows: [] };
    }

    if (source.includes('UPDATE scheduled_task_dispatches')) {
      assert.equal(params[5], 'already_practiced_today');
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query in automated idiom practice skip test: ${source.slice(0, 180)}`);
  }, async () => {
    const result = await sendIdiomPracticeReminderCore({
      chatId: 88,
      botKey: 'en-de'
    });

    assert.equal(result, null);
  });
});

test('automated day1 return sends generic text after 22 hours of inactivity', async () => {
  const telegramBodies = [];

  await withMockedQuery(async (source, params = []) => {
    if (source.includes('FROM users u') && source.includes('LEFT JOIN scheduled_task_dispatches onboarding')) {
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
    if (source.includes('FROM users u') && source.includes('LEFT JOIN scheduled_task_dispatches onboarding')) {
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
