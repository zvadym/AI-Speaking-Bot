import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import type { EntitlementContext } from '../src/bot-runtime/entitlement-context.js';
import { BotRuntimeHandlerError } from '../src/bot-runtime/handler-registry.js';
import {
  buildLimitReachedSubscriptionUrl,
  enforcePracticeQuota,
  PRACTICE_QUOTA_DELIVERY_STEP_KEY,
  PRACTICE_QUOTA_EFFECT_STEP_KEY
} from '../src/bot-runtime/practice-quota.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const unusedPool = null as unknown as Pool;

function preparedText(): PreparedUpdate {
  return buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId: 9811, text: 'Hello' }))
  });
}

function entitlement(overrides: Partial<EntitlementContext> = {}): EntitlementContext {
  return {
    tier: 'free',
    planExpiresOn: null,
    planAutorenew: false,
    pendingPlanTier: null,
    pendingPlanEffectiveOn: null,
    limitPeriod: 'lifetime',
    limitSeconds: 240,
    usedSeconds: 120,
    remainingSeconds: 120,
    limitReached: false,
    ...overrides
  };
}

test('practice quota allows updates without creating effects or deliveries', async () => {
  let effectCalls = 0;
  let deliveryCalls = 0;
  const result = await enforcePracticeQuota({
    pool: unusedPool,
    update: preparedText(),
    getBotLocale: () => ({}),
    telegramClient: { async sendTelegramTextMessage() { return { message_id: 1 }; } },
    webappUrl: 'https://example.test/app',
    entitlementLoader: async () => entitlement(),
    effectRunner: async <T extends Record<string, unknown>>() => {
      effectCalls += 1;
      return { duplicate: false, result: {} as T };
    },
    textDeliverer: async () => {
      deliveryCalls += 1;
      return { status: 'delivered' };
    }
  });

  assert.equal(result.allowed, true);
  assert.equal(effectCalls, 0);
  assert.equal(deliveryCalls, 0);
});

test('practice quota records and delivers one localized subscription paywall', async () => {
  const update = preparedText();
  const effectSteps: string[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const result = await enforcePracticeQuota({
    pool: unusedPool,
    update,
    getBotLocale: () => ({
      msg_limit_reached: 'Ліміт використано.',
      btn_open_subscription: 'Відкрити підписку'
    }),
    telegramClient: { async sendTelegramTextMessage() { return { message_id: 1 }; } },
    webappUrl: 'https://example.test/app?old=1',
    entitlementLoader: async () => entitlement({
      usedSeconds: 240,
      remainingSeconds: 0,
      limitReached: true
    }),
    effectRunner: async <T extends Record<string, unknown>>(
      _pool: Pool,
      input: {
        decisionId: string;
        stepKey: string;
        execute(client: PoolClient): Promise<T>;
      }
    ) => {
      effectSteps.push(input.stepKey);
      const effectResult = await input.execute({
        async query(sql: string, params: unknown[]) {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        }
      } as unknown as PoolClient);
      return { duplicate: false, result: effectResult };
    },
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 88 };
    }
  });

  assert.equal(result.allowed, false);
  if (result.allowed) assert.fail('expected blocked quota');
  assert.deepEqual(result.outcome, { status: 'delivered', telegramMessageId: 88 });
  assert.deepEqual(effectSteps, [PRACTICE_QUOTA_EFFECT_STEP_KEY]);
  assert.match(queries[0].sql, /'paywall_shown', 'bot_runtime'/);
  assert.match(queries[0].sql, /\$1::bigint, \$2::text/);
  assert.match(queries[0].sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.equal(queries[0].params[0], update.input.chatId);
  assert.equal(queries[0].params[1], 'uk-en');
  assert.equal(deliveries[0].stepKey, PRACTICE_QUOTA_DELIVERY_STEP_KEY);
  assert.equal(deliveries[0].text, 'Ліміт використано.');
  assert.equal(
    (deliveries[0].replyMarkup as { inline_keyboard: Array<Array<{ web_app: { url: string } }>> })
      .inline_keyboard[0][0].web_app.url,
    'https://example.test/subscription?bot-key=uk-en&entry=limit_reached'
  );
});

test('practice quota runs the pre-paywall callback before durable delivery', async () => {
  const order: string[] = [];
  await enforcePracticeQuota({
    pool: unusedPool,
    update: preparedText(),
    getBotLocale: () => ({}),
    telegramClient: { async sendTelegramTextMessage() { return { message_id: 1 }; } },
    webappUrl: 'https://example.test',
    entitlementLoader: async () => entitlement({ limitReached: true, remainingSeconds: 0 }),
    effectRunner: async <T extends Record<string, unknown>>() => {
      order.push('effect');
      return { duplicate: false, result: { recorded: true } as unknown as T };
    },
    beforeBlockedDelivery: async () => { order.push('reply'); },
    textDeliverer: async () => {
      order.push('paywall');
      return { status: 'delivered' };
    }
  });
  assert.deepEqual(order, ['effect', 'reply', 'paywall']);
});

test('practice quota fails closed when entitlement context is unavailable', async () => {
  await assert.rejects(
    enforcePracticeQuota({
      pool: unusedPool,
      update: preparedText(),
      getBotLocale: () => ({}),
      telegramClient: { async sendTelegramTextMessage() { return { message_id: 1 }; } },
      webappUrl: 'https://example.test',
      entitlementLoader: async () => { throw new Error('missing plan'); }
    }),
    (error: unknown) => error instanceof BotRuntimeHandlerError
      && error.code === 'practice_quota_unavailable'
      && error.retryable
  );
});

test('limit reached subscription URL replaces existing paths and query parameters', () => {
  assert.equal(
    buildLimitReachedSubscriptionUrl('https://example.test/old?x=1', 'de-en'),
    'https://example.test/subscription?bot-key=de-en&entry=limit_reached'
  );
});
