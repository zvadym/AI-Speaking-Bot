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
process.env.DISCORD_EVENTS_WEBHOOK_URL ??= 'https://discord.test/api/webhooks/123';

const [{ createApiHelpers }, { QUEUE_DISCORD_EVENT_SEND }] = await Promise.all([
  import('../src/services/api-helpers.js'),
  import('../src/queue.js')
]);

function createHelpers({ poolQuery, bossSend, sendTelegramTextMessage = async () => ({ message_id: 1 }) }) {
  return createApiHelpers({
    env: {
      defaultBotKey: 'uk-de',
      discordEventsWebhookUrl: 'https://discord.test/api/webhooks/123',
      discordUserMilestoneStep: 100,
      botKeyByTargetLang: {}
    },
    pool: {
      query: poolQuery
    },
    stripe: {
      subscriptionSchedules: {
        retrieve: async () => ({ phases: [] })
      },
      subscriptions: {
        retrieve: async () => {
          throw new Error('unexpected_subscriptions_retrieve');
        }
      }
    },
    botConfigs: {},
    publicBotCatalog: [],
    publicBotCatalogByKey: {},
    publicBotMetaForKey: () => null,
    getBotLocale: () => ({}),
    telegramClient: {
      sendTelegramTextMessage,
      uploadTelegramMediaToChat: async () => null,
      deleteTelegramMessage: async () => null
    },
    deliveryState: {
      updateUserDeliveryState: async () => null
    },
    actionEvents: {
      recordActionEventSafe: async () => null
    },
    apiBoss: {
      send: bossSend
    }
  });
}

test('upsertUser queues a Discord milestone when total users reaches the configured step', async () => {
  const bossCalls = [];
  const helpers = createHelpers({
    poolQuery: async (source) => {
      if (source.includes('INSERT INTO users') && source.includes('ON CONFLICT (chat_id) DO NOTHING')) {
        return { rowCount: 1, rows: [{ chat_id: 500 }] };
      }
      if (source.includes('SELECT COUNT(*)::int AS total_users')) {
        return { rows: [{ total_users: 100 }] };
      }
      if (source.includes('INSERT INTO user_bots')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query in upsertUser milestone test: ${source.slice(0, 180)}`);
    },
    bossSend: async (...args) => {
      bossCalls.push(args);
      return 'job-1';
    }
  });

  await helpers.upsertUser({
    id: 500,
    username: 'alice',
    first_name: 'Alice'
  }, { botKey: 'uk-de' });

  assert.equal(bossCalls.length, 1);
  assert.equal(bossCalls[0][0], QUEUE_DISCORD_EVENT_SEND);
  assert.equal(bossCalls[0][1].type, 'user_milestone');
  assert.equal(bossCalls[0][1].total_users, 100);
  assert.equal(bossCalls[0][2].singletonKey, 'discord_event:user_milestone:100');
});

test('handleStripeEvent queues a Discord notification only for the first paid conversion', async () => {
  const bossCalls = [];
  const telegramCalls = [];
  const helpers = createHelpers({
    poolQuery: async (source, params = []) => {
      if (source.includes('SELECT chat_id') && source.includes('WHERE stripe_customer_id = $1') && source.includes('LIMIT 1')) {
        return { rows: [{ chat_id: 42 }] };
      }
      if (source.includes('INSERT INTO payments')) {
        return { rowCount: 1, rows: [] };
      }
      if (source.includes('SELECT tier') && source.includes('FROM plan_prices')) {
        assert.equal(params[0], 'price_pro');
        return { rows: [{ tier: 'pro' }] };
      }
      if (source.includes('SELECT chat_id, plan_tier, stripe_price_id, plan_started_at, username, first_name')) {
        return {
          rows: [{
            chat_id: 42,
            plan_tier: 'free',
            stripe_price_id: null,
            plan_started_at: null,
            username: 'alice',
            first_name: 'Alice'
          }]
        };
      }
      if (source.includes('UPDATE users') && source.includes('SET plan_tier = $1')) {
        return { rows: [{ chat_id: 42 }], rowCount: 1 };
      }
      if (source.includes('FROM user_bots') && source.includes('COALESCE(is_active, true) DESC')) {
        return { rows: [{ bot_key: 'uk-de' }] };
      }
      throw new Error(`Unexpected query in handleStripeEvent test: ${source.slice(0, 180)}`);
    },
    bossSend: async (...args) => {
      bossCalls.push(args);
      return 'job-2';
    },
    sendTelegramTextMessage: async (...args) => {
      telegramCalls.push(args);
      return { message_id: 1 };
    }
  });

  await helpers.handleStripeEvent({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1780000000,
        current_period_end: 1790000000,
        items: {
          data: [{
            price: {
              id: 'price_pro',
              currency: 'eur'
            }
          }]
        }
      }
    }
  });

  assert.equal(bossCalls.length, 1);
  assert.equal(bossCalls[0][0], QUEUE_DISCORD_EVENT_SEND);
  assert.equal(bossCalls[0][1].type, 'new_paid_user');
  assert.equal(bossCalls[0][1].chat_id, 42);
  assert.equal(bossCalls[0][1].plan_tier, 'pro');
  assert.equal(bossCalls[0][2].singletonKey, 'discord_event:new_paid_user:42');
  assert.deepEqual(telegramCalls, [[42, '🎉 Твій план змінено: FREE → PRO ✨', { botKey: 'uk-de' }]]);
});

test('sendDiscordEventNotification supports user feedback events', async () => {
  const { sendDiscordEventNotification } = await import('../src/discord-events.js');
  let captured = null;

  const result = await sendDiscordEventNotification({
    webhookUrl: 'https://discord.test/api/webhooks/123',
    event: {
      type: 'user_feedback',
      feedback_id: 77,
      chat_id: 42,
      username: 'alice',
      first_name: 'Alice',
      bot_key: 'uk-de',
      category: 'idea',
      feedback_text: 'Need more drills',
      kind: 'text',
      source: 'miniapp'
    },
    botMetaForKey: () => ({ bot_name: 'Deutsch Trainer' }),
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return {
        ok: true
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, 'user_feedback');
  assert.equal(captured.username, 'AI School Events');
  assert.equal(captured.embeds[0].title, 'New user feedback');
  assert.equal(captured.embeds[0].description, 'Need more drills');
  assert.equal(captured.embeds[0].fields.find((entry) => entry.name === 'Category')?.value, 'idea');
  assert.equal(captured.embeds[0].fields.find((entry) => entry.name === 'Bot')?.value, 'uk-de (Deutsch Trainer)');
});
