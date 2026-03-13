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
  sendAdminTestWeeklyDigestReminder,
  sendDay1ReturnReminderCore,
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
        'Ready for a 2-minute practice? Write one short sentence.',
        'Want to do a quick practice? Write one short sentence.'
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
