import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { parsePreparedUpdateContract, PreparedUpdateContractError } from '../src/bot-runtime/contract-validation.js';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import {
  BotRuntimeHandlerError,
  createBotHandlerRegistry,
  type BotHandler
} from '../src/bot-runtime/handler-registry.js';
import {
  BotUpdateIngestionError,
  ingestBotUpdate
} from '../src/bot-runtime/ingestion-service.js';
import {
  classifyTelegramDeliveryError,
  createStatsHandler
} from '../src/bot-runtime/handlers/stats.js';
import { buildStaticRouteMessage } from '../src/bot-runtime/handlers/static-routes.js';
import { processBotUpdateJob } from '../src/bot-runtime/register-worker.js';
import {
  parseBotRuntimeRouteFlags
} from '../src/bot-runtime/route-flags.js';
import type { StatsContext } from '../src/bot-runtime/stats-context.js';
import { buildStatsMessage } from '../src/bot-runtime/stats-message.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import type { XpContext } from '../src/bot-runtime/xp-context.js';
import { buildXpMessage } from '../src/bot-runtime/xp-message.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const unusedPool = null as unknown as Pool;

function preparedStats(updateId = 9001): PreparedUpdate & { route: 'command.stats' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: '/stats' }))
  });
  assert.equal(prepared.route, 'command.stats');
  return prepared as PreparedUpdate & { route: 'command.stats' };
}

function statsContext(overrides: Partial<StatsContext> = {}): StatsContext {
  return {
    tier: 'free',
    planExpiresOn: null,
    planAutorenew: false,
    pendingPlanTier: null,
    pendingPlanEffectiveOn: null,
    limitPeriod: 'lifetime',
    limitSeconds: 100,
    usedSeconds: 50,
    remainingSeconds: 50,
    limitReached: false,
    ...overrides
  };
}

function xpContext(overrides: Partial<XpContext> = {}): XpContext {
  return {
    xpTotal: 450,
    streakCurrent: 3,
    streakBest: 7,
    level: 3,
    xpIntoLevel: 50,
    xpPerLevel: 200,
    xpToNext: 150,
    xpDailyToday: 125,
    xpDailyLimit: 250,
    xpDailyRemaining: 125,
    streakMultiplier: 1,
    ...overrides
  };
}

const statsLocale = {
  stats_title: '<b>Stats</b>',
  stats_plan_prefix: 'Plan: ',
  tier_pro: 'PRO',
  tier_plus: 'PLUS',
  tier_free: 'FREE',
  plan_valid_until_prefix: 'Valid until: ',
  stats_week_title: '<b>This month</b>',
  stats_free_title: '<b>Free limit</b>',
  stats_practice_prefix: 'Practice: ',
  stats_autorenew_prefix: 'Autorenew: ',
  autorenew_on: 'on',
  autorenew_off: 'off',
  stats_pending_prefix: 'Pending: ',
  pending_change_prefix: 'to ',
  pending_change_suffix: ' later',
  stats_footer: 'Footer',
  btn_open_subscription: 'Open'
};

test('route flags are dark by default and reject unsafe configuration', () => {
  assert.equal(parseBotRuntimeRouteFlags('', ['uk-en']).size, 0);
  const enabled = parseBotRuntimeRouteFlags('{"uk-en":["command.stats"]}', ['uk-en']);
  assert.equal(enabled.get('uk-en')?.has('command.stats'), true);
  const easyRoutes = parseBotRuntimeRouteFlags(
    '{"uk-en":["command.xp","command.level","command.voice"]}',
    ['uk-en']
  );
  assert.equal(easyRoutes.get('uk-en')?.has('command.xp'), true);

  assert.throws(
    () => parseBotRuntimeRouteFlags('{"missing":["command.stats"]}', ['uk-en']),
    /unknown bot key/
  );
  assert.throws(
    () => parseBotRuntimeRouteFlags('{"uk-en":["message.text"]}', ['uk-en']),
    /unimplemented route/
  );
  assert.throws(
    () => parseBotRuntimeRouteFlags('{"uk-en":"command.stats"}', ['uk-en']),
    /must map to an array/
  );
});

test('Contract v1 validation rejects a mismatched deterministic decision ID', () => {
  const contract = preparedStats();
  assert.equal(parsePreparedUpdateContract(contract), contract);
  assert.throws(
    () => parsePreparedUpdateContract({ ...contract, decisionId: 'v1:uk-en:other' }),
    PreparedUpdateContractError
  );
});

test('ingestion is disabled by default without touching pg-boss', async () => {
  const calls: unknown[] = [];
  const result = await ingestBotUpdate({
    apiBoss: {
      async send(...args) {
        calls.push(args);
        return 'job-id';
      }
    },
    env: { botRuntimeRouteFlags: parseBotRuntimeRouteFlags('', ['uk-en']) },
    publicBotMetaForKey: (botKey) => botKey === 'uk-en' ? { bot_key: 'uk-en' } : null
  }, preparedStats());

  assert.deepEqual(result, { accepted: false, error: 'route_not_enabled' });
  assert.deepEqual(calls, []);
});

test('ingestion publishes a versioned singleton job and accepts singleton conflicts', async () => {
  const calls: unknown[][] = [];
  const flags = parseBotRuntimeRouteFlags('{"uk-en":["command.stats"]}', ['uk-en']);
  const contract = preparedStats(9002);
  const context = {
    apiBoss: {
      async send(...args: unknown[]) {
        calls.push(args);
        return calls.length === 1 ? 'job-123' : null;
      }
    },
    env: { botRuntimeRouteFlags: flags },
    publicBotMetaForKey: (botKey: unknown) => botKey === 'uk-en' ? { bot_key: 'uk-en' } : null
  };

  assert.deepEqual(await ingestBotUpdate(context, contract), {
    accepted: true,
    duplicate: false,
    jobId: 'job-123'
  });
  assert.deepEqual(await ingestBotUpdate(context, contract), {
    accepted: true,
    duplicate: true
  });
  assert.equal(calls[0][0], 'bot-update-process');
  assert.deepEqual(calls[0][1], { contract, handlerVersion: 1 });
  assert.equal(
    (calls[0][2] as Record<string, unknown>).singletonKey,
    'bot-update:uk-en:9002'
  );

  await assert.rejects(
    () => ingestBotUpdate(context, { ...contract, contractVersion: 2 }),
    (error: unknown) => error instanceof BotUpdateIngestionError && error.code === 'invalid_contract'
  );

  await assert.rejects(
    () => ingestBotUpdate({
      ...context,
      apiBoss: { async send() { throw new Error('queue unavailable'); } }
    }, contract),
    (error: unknown) => error instanceof BotUpdateIngestionError && error.code === 'enqueue_failed'
  );
});

test('stats formatter preserves the legacy free and paid layouts', () => {
  const free = buildStatsMessage({
    context: statsContext(),
    locale: statsLocale,
    botKey: 'uk-en',
    webappUrl: 'https://example.test/app'
  });
  assert.equal(
    free.text,
    '<b>Stats</b>\n\nPlan: FREE\n\n<b>Free limit</b>\nPractice: <code>[■■■□□□]</code>\n\nFooter'
  );
  assert.equal(
    free.replyMarkup.inline_keyboard[0][0].web_app.url,
    'https://example.test/subscription?bot-key=uk-en&entry=subscription_stats'
  );

  const paid = buildStatsMessage({
    context: statsContext({
      tier: 'pro',
      planExpiresOn: '2026-08-10',
      planAutorenew: true,
      pendingPlanTier: 'free',
      limitSeconds: 100,
      usedSeconds: 100
    }),
    locale: statsLocale,
    botKey: 'uk-en',
    webappUrl: 'https://example.test'
  });
  assert.equal(
    paid.text,
    '<b>Stats</b>\n\nPlan: PRO\nValid until: 2026-08-10\n\n<b>This month</b>\nPractice: <code>[■■■■■■]</code>\n\nAutorenew: on\nPending: to FREE later\n\nFooter'
  );
});

test('XP formatter preserves progress bars and the persistent keyboard', () => {
  const update = preparedStats();
  const message = buildXpMessage({
    context: xpContext(),
    locale: {
      xp_title: '<b>Progress</b>',
      xp_streak_label: 'Streak',
      xp_best_label: 'Best',
      xp_level_label: 'Level',
      xp_total_label: 'XP',
      xp_today_title: 'Today',
      xp_daily_cap_label: 'Cap',
      xp_today_left_label: 'Left',
      xp_level_progress_label: 'Level progress',
      xp_next_label: 'Next',
      xp_streak_bonus_label: 'Bonus',
      xp_streak_bonus_pending: 'Pending'
    },
    keyboard: update.context.keyboard
  });

  assert.match(message.text, /<code>\[■■■■□□□□\]<\/code> <b>125<\/b> \/ 250 XP/);
  assert.match(message.text, /<code>\[■■□□□□□□\]<\/code> <b>50<\/b> \/ 200 XP/);
  assert.deepEqual(message.replyMarkup.keyboard, [
    [
      { text: update.context.keyboard.topicButtonText },
      { text: update.context.keyboard.levelButtonText }
    ],
    [
      { text: update.context.keyboard.voiceButtonText },
      { text: update.context.keyboard.xpButtonText }
    ]
  ]);
});

test('static command formatters preserve legacy menu callback payloads', () => {
  const update = preparedStats();
  const level = buildStaticRouteMessage('command.level', update, {
    choose_level_text: 'Choose level'
  });
  assert.equal(level?.text, 'Choose level');
  assert.deepEqual(level?.replyMarkup, {
    inline_keyboard: [
      [
        { text: 'A1', callback_data: 'level:a1' },
        { text: 'A2', callback_data: 'level:a2' },
        { text: 'B1', callback_data: 'level:b1' }
      ],
      [
        { text: 'B2', callback_data: 'level:b2' },
        { text: 'C1', callback_data: 'level:c1' }
      ]
    ]
  });

  const voice = buildStaticRouteMessage('command.voice', update, {
    choose_voice_mode_text: 'Choose mode',
    voice_mode_text: 'Text',
    voice_mode_voice: 'Voice'
  });
  assert.deepEqual(voice?.replyMarkup, {
    inline_keyboard: [[
      { text: 'Text', callback_data: 'reply:text' },
      { text: 'Voice', callback_data: 'reply:voice' }
    ]]
  });
});

test('stats handler returns delivered records without sending again', async () => {
  let sendCount = 0;
  const handler = createStatsHandler({
    pool: unusedPool,
    getBotLocale: () => statsLocale,
    telegramClient: {
      async sendTelegramTextMessage() {
        sendCount += 1;
        return { message_id: 99 };
      }
    },
    webappUrl: 'https://example.test',
    statsContextLoader: async () => statsContext(),
    deliveryRepository: {
      begin: async () => ({ action: 'delivered', deliveryId: '1', telegramMessageId: 77 }),
      markDelivered: async () => {},
      markFailed: async () => {},
      markUnknown: async () => {}
    }
  });

  assert.deepEqual(await handler.execute(preparedStats()), {
    status: 'duplicate',
    telegramMessageId: 77
  });
  assert.equal(sendCount, 0);
});

test('stats handler sends HTML once and records the Telegram message ID', async () => {
  const transitions: Array<{ status: string; messageId?: number | null }> = [];
  const handler = createStatsHandler({
    pool: unusedPool,
    getBotLocale: () => statsLocale,
    telegramClient: {
      async sendTelegramTextMessage(chatId, text, options) {
        assert.equal(chatId, 42);
        assert.match(text, /<code>\[■■■□□□\]<\/code>/);
        assert.equal(options.parseMode, 'HTML');
        return { message_id: 99 };
      }
    },
    webappUrl: 'https://example.test',
    statsContextLoader: async () => statsContext(),
    deliveryRepository: {
      begin: async () => ({ action: 'send', deliveryId: '1', attempts: 1 }),
      markDelivered: async (_pool, _deliveryId, messageId) => {
        transitions.push({ status: 'delivered', messageId });
      },
      markFailed: async () => { transitions.push({ status: 'failed' }); },
      markUnknown: async () => { transitions.push({ status: 'unknown' }); }
    }
  });

  assert.deepEqual(await handler.execute(preparedStats()), {
    status: 'delivered',
    telegramMessageId: 99
  });
  assert.deepEqual(transitions, [{ status: 'delivered', messageId: 99 }]);
});

test('ambiguous Telegram timeout becomes unknown and is never retryable', async () => {
  const classified = classifyTelegramDeliveryError(
    Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })
  );
  assert.equal(classified.kind, 'unknown');

  const transitions: string[] = [];
  const handler = createStatsHandler({
    pool: unusedPool,
    getBotLocale: () => statsLocale,
    telegramClient: {
      async sendTelegramTextMessage() {
        throw Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' });
      }
    },
    webappUrl: 'https://example.test',
    statsContextLoader: async () => statsContext(),
    deliveryRepository: {
      begin: async () => ({ action: 'send', deliveryId: '1', attempts: 1 }),
      markDelivered: async () => { transitions.push('delivered'); },
      markFailed: async () => { transitions.push('failed'); },
      markUnknown: async () => { transitions.push('unknown'); }
    }
  });

  await assert.rejects(
    () => handler.execute(preparedStats()),
    (error: unknown) =>
      error instanceof BotRuntimeHandlerError &&
      error.code === 'telegram_delivery_timeout' &&
      error.retryable === false
  );
  assert.deepEqual(transitions, ['unknown']);
});

test('worker records retryable and permanent handler outcomes', async () => {
  const contract = preparedStats(9003);
  const failures: Array<{ retryable: boolean; errorCode: string }> = [];
  let mode: 'retryable' | 'permanent' = 'retryable';
  const handler: BotHandler<'command.stats'> = {
    route: 'command.stats',
    version: 1,
    async execute() {
      throw new BotRuntimeHandlerError(
        mode === 'retryable' ? 'temporary_stats_failure' : 'invalid_stats_state',
        { retryable: mode === 'retryable' }
      );
    }
  };
  const registry = createBotHandlerRegistry([handler]);
  const executionRepository = {
    claim: async () => ({ outcome: 'claimed' as const, attempts: 1 }),
    markSucceeded: async () => {},
    markFailed: async (
      _pool: Pool,
      _decisionId: string,
      _jobId: string,
      failure: { retryable: boolean; errorCode: string }
    ) => { failures.push(failure); }
  };

  await assert.rejects(
    () => processBotUpdateJob({
      id: '00000000-0000-4000-8000-000000000001',
      data: { contract, handlerVersion: 1 },
      retryCount: 0,
      retryLimit: 5
    }, { pool: unusedPool, registry, executionRepository }),
    BotRuntimeHandlerError
  );
  assert.deepEqual(failures[0], {
    retryable: true,
    errorCode: 'temporary_stats_failure'
  });

  mode = 'permanent';
  assert.equal(await processBotUpdateJob({
    id: '00000000-0000-4000-8000-000000000002',
    data: { contract, handlerVersion: 1 },
    retryCount: 0,
    retryLimit: 5
  }, { pool: unusedPool, registry, executionRepository }), 'permanent_failed');
  assert.deepEqual(failures[1], {
    retryable: false,
    errorCode: 'invalid_stats_state'
  });
});
