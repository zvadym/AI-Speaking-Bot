import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import type { Pool } from 'pg';
import { parseBotRuntimeRouteFlags } from '../src/bot-runtime/route-flags.js';
import { deriveTelegramWebhookSecret } from '../src/bot-runtime/webhook-secret.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:5432/test_db';
process.env.WEBAPP_URL ??= 'https://example.test/app';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_123';
process.env.JWT_SECRET ??= 'jwt_secret_for_tests';
process.env.SENTRY_TEST_MODE ??= '1';

const { createTelegramWebhookRouter } = await import('../src/routes/telegram-webhook.js');

async function post(app: express.Express, secret: string | null) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/telegram/webhook/uk-de`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {})
        },
        body: JSON.stringify(messageUpdate({ updateId: 7001, text: '/stats' }))
      }
    );
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('direct Telegram webhook validates its secret and durably enqueues prepared updates', async () => {
  const transactionQueries: string[] = [];
  const jobs: Array<Record<string, unknown>> = [];
  const pool = {
    async connect() {
      return {
        async query(source: string) {
          transactionQueries.push(source);
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    },
    async query() {
      return { rows: [] };
    }
  } as unknown as Pool;
  const botToken = '7000000000:test-token';
  const signingSecret = 'internal-test-secret';
  const ctx = {
    pool,
    apiBoss: {
      async send(name: string, data: object, options: Record<string, unknown>) {
        jobs.push({ name, data, options });
        return '00000000-0000-4000-8000-000000000001';
      }
    },
    env: {
      botRuntimeRouteFlags: parseBotRuntimeRouteFlags(
        '{"uk-de":["command.stats"]}',
        ['uk-de']
      ),
      internalApiSecret: signingSecret,
      jwtSecret: 'jwt-secret',
      telegramBotTokensByBotKey: { 'uk-de': botToken }
    },
    publicBotMetaForKey(botKey: unknown) {
      return botKey === 'uk-de' ? { bot_key: 'uk-de' } : null;
    },
    getBotLocale() { return {}; }
  };
  const app = express();
  app.use(express.json());
  app.use(createTelegramWebhookRouter(ctx));

  assert.deepEqual(await post(app, null), {
    status: 401,
    body: { error: 'invalid_webhook_secret' }
  });
  assert.equal(jobs.length, 0);

  const secret = deriveTelegramWebhookSecret({
    botKey: 'uk-de',
    botToken,
    signingSecret
  });
  assert.deepEqual(await post(app, secret), {
    status: 200,
    body: { ok: true }
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'bot-update-process');
  assert.match(JSON.stringify(jobs[0].options), /bot-update:uk-de:7001/);
  assert.ok(transactionQueries.some((source) => source.includes('INSERT INTO users')));
  assert.ok(transactionQueries.some((source) => source.includes('INSERT INTO user_bots')));
});
