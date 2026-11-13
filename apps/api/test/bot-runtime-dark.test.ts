import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
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
} from '../src/bot-runtime/execution/ingestion-service.js';
import { classifyTelegramDeliveryError, deliverTelegramText } from '../src/bot-runtime/delivery/telegram-text-delivery.js';
import { createCallbackActionHandlers } from '../src/bot-runtime/handlers/callback-actions.js';
import { createSupportCallbackHandlers } from '../src/bot-runtime/handlers/support-callbacks.js';
import { createTextConversationHandler } from '../src/bot-runtime/handlers/conversation.js';
import { createVoiceConversationHandler } from '../src/bot-runtime/handlers/voice.js';
import type { BotAiClient } from '../src/ai/client.js';
import { buildStaticRouteMessage } from '../src/bot-runtime/handlers/static-routes.js';
import { processBotUpdateJob } from '../src/bot-runtime/register-worker.js';
import {
  BOT_RUNTIME_HANDLER_VERSIONS,
  parseBotRuntimeRouteFlags
} from '../src/bot-runtime/route-flags.js';
import { ROUTES } from '../src/bot-runtime/contracts.js';
import type { StatsContext } from '../src/bot-runtime/settings/stats-context.js';
import { buildStatsMessage } from '../src/bot-runtime/settings/stats-message.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { callbackUpdate, messageUpdate, voice } from './fixtures/telegram-updates.js';

const unusedPool = null as unknown as Pool;

function preparedStats(updateId = 9001): PreparedUpdate & { route: 'command.unknown' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: '/not-a-command' }))
  });
  assert.equal(prepared.route, 'command.unknown');
  return prepared as PreparedUpdate & { route: 'command.unknown' };
}

function preparedText(updateId = 9351): PreparedUpdate & { route: 'message.text' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: 'I goed home.' }))
  });
  assert.equal(prepared.route, 'message.text');
  return prepared as PreparedUpdate & { route: 'message.text' };
}

function preparedVoice(updateId = 9352): PreparedUpdate & { route: 'message.voice' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, voice }))
  });
  assert.equal(prepared.route, 'message.voice');
  return prepared as PreparedUpdate & { route: 'message.voice' };
}

const unusedAi = null as unknown as BotAiClient;

function preparedCallback<R extends PreparedUpdate['route']>(
  route: R,
  data: string,
  updateId = 9401
): PreparedUpdate & { route: R } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(callbackUpdate({ updateId, data }))
  });
  assert.equal(prepared.route, route);
  return prepared as PreparedUpdate & { route: R };
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

async function allowPracticeQuota() {
  return { allowed: true as const, context: statsContext() };
}

const statsLocale = {
  stats_title: '<b>Stats</b>',
  stats_plan_prefix: 'Plan: ',
  tier_pro: 'PRO',
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
  const enabled = parseBotRuntimeRouteFlags('{"uk-en":["command.unknown"]}', ['uk-en']);
  assert.equal(enabled.get('uk-en')?.has('command.unknown'), true);
  assert.throws(()=>parseBotRuntimeRouteFlags('{\"uk-en\":[\"command.level\"]}',['uk-en']), /unknown route/);

  assert.throws(
    () => parseBotRuntimeRouteFlags('{"missing":["command.unknown"]}', ['uk-en']),
    /unknown bot key/
  );
  assert.throws(
    () => parseBotRuntimeRouteFlags('{"uk-en":["not-a-route"]}', ['uk-en']),
    /unknown route/
  );
  assert.throws(
    () => parseBotRuntimeRouteFlags('{"uk-en":"command.unknown"}', ['uk-en']),
    /must map to an array/
  );
});

test('typed runtime has a versioned handler for every prepared route', () => {
  assert.deepEqual(Object.keys(BOT_RUNTIME_HANDLER_VERSIONS).sort(), [...ROUTES].sort());
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
  const flags = parseBotRuntimeRouteFlags('{"uk-en":["command.unknown"]}', ['uk-en']);
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

test('retired command reply preserves language controls without progress', () => {
  const update = preparedStats();
  const message = buildStaticRouteMessage('command.unknown', update, { msg_error_command: 'Unknown command' });
  assert.equal(message!.text, 'Unknown command');
  assert.deepEqual((message!.replyMarkup as {keyboard:unknown}).keyboard, [[{ text: update.context.keyboard.settingsButtonText }]]);
  assert.doesNotMatch(JSON.stringify(message), /XP/);
});

test('support translation callback reuses cached AI effect and edits the source message', async () => {
  const update = preparedCallback('callback.translate', 'tr:123:000', 9403);
  const edits: Array<Record<string, unknown>> = [];
  const handler = createSupportCallbackHandlers({
    pool: unusedPool,
    getBotLocale: () => ({ translation_header: 'Translation:' }),
    telegramClient: {
      async callTelegramApi() { throw new Error('unexpected API call'); },
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async answerTelegramCallbackQuery() {},
      async editTelegramMessageText(chatId, sourceMessageId, text, options) {
        edits.push({ chatId, sourceMessageId, text, options });
        return {};
      }
    },
    ai: unusedAi,
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: { translation: 'Переклад' } as unknown as T
    })
  }).find((item) => item.route === 'callback.translate');
  assert.ok(handler);
  assert.deepEqual(await handler.execute(update), { status: 'noop' });
  assert.equal(edits.length, 1);
  assert.match(String(edits[0].text), /Translation:\nПереклад/);
});

test('text conversation reuses generated state and delivers correction before reply', async () => {
  const update = preparedText();
  const methods: string[] = [];
  const progress: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handler = createTextConversationHandler({
    async withProgress(_update, operation) {
      progress.push('start');
      try { return await operation(); } finally { progress.push('stop'); }
    },
    pool: unusedPool,
    webappUrl: 'https://example.test/app',
    quotaGuard: allowPracticeQuota,
    getBotLocale: () => ({
      btn_translation: 'Translation',
      btn_vocab: 'Vocabulary',
      btn_follow_up_hints: 'Hints'
    }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async callTelegramApi(_botKey, method) {
        methods.push(method);
        return {};
      }
    },
    ai: unusedAi,
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: {
        assistantMessageId: 555,
        response: {
          detected_language: 'en',
          is_target_language: true,
          has_mistakes: true,
          reply_text: 'What did you do there?',
          explanation_html: '<b>Correction</b>: I went home.'
        }
      } as unknown as T
    }),
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: deliveries.length };
    }
  });
  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 2
  });
  assert.deepEqual(methods, ['sendChatAction']);
  assert.deepEqual(progress, ['start', 'stop']);
  assert.deepEqual(deliveries.map((item) => item.stepKey), [
    'message.text:correction:v1',
    'message.text:reply:v1'
  ]);
  assert.match(JSON.stringify(deliveries[1].replyMarkup), /tr:555:000/);
});

test('text conversation blocks before typing and AI when global quota is exhausted', async () => {
  const methods: string[] = [];
  let conversationEffects = 0;
  let progressCalls = 0;
  const handler = createTextConversationHandler({
    async withProgress(_update, operation) {
      progressCalls += 1;
      return operation();
    },
    pool: unusedPool,
    webappUrl: 'https://example.test/app',
    getBotLocale: () => ({}),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async callTelegramApi(_botKey, method) {
        methods.push(method);
        return {};
      }
    },
    ai: unusedAi,
    quotaGuard: async () => ({
      allowed: false,
      context: statsContext({ limitReached: true, remainingSeconds: 0 }),
      outcome: { status: 'delivered', telegramMessageId: 91 }
    }),
    effectRunner: async <T extends Record<string, unknown>>() => {
      conversationEffects += 1;
      return { duplicate: false, result: {} as T };
    }
  });

  assert.deepEqual(await handler.execute(preparedText(9353)), {
    status: 'delivered',
    telegramMessageId: 91
  });
  assert.deepEqual(methods, []);
  assert.equal(conversationEffects, 0);
  assert.equal(progressCalls, 0);
});

test('voice conversation reuses STT state and delivers transcript before text reply', async () => {
  const update = preparedVoice();
  const deliveries: Array<Record<string, unknown>> = [];
  const progress: string[] = [];
  const pool = {
    async query() {
      return { rows: [{ limit_seconds: 0, used_seconds: 0 }] };
    }
  } as unknown as Pool;
  const handler = createVoiceConversationHandler({
    async withProgress(_update, operation) {
      progress.push('start');
      try { return await operation(); } finally { progress.push('stop'); }
    },
    pool,
    webappUrl: 'https://example.test/app',
    quotaGuard: allowPracticeQuota,
    getBotLocale: () => ({ user_text_prefix_multiline: 'You said:\n' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async sendTelegramVoiceMessage() { return { message_id: 2 }; },
      async downloadTelegramFile() { return Buffer.from('voice'); },
      async callTelegramApi() { return {}; }
    },
    ai: unusedAi,
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: {
        transcript: 'I went home.',
        assistantMessageId: 556,
        replyMode: 'text',
        response: {
          detected_language: 'en',
          is_target_language: true,
          has_mistakes: false,
          reply_text: 'What did you do there?',
          explanation_html: '<b>Good</b>'
        }
      } as unknown as T
    }),
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: deliveries.length };
    }
  });
  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 2
  });
  assert.deepEqual(deliveries.map((item) => item.stepKey), [
    'message.voice:transcript:v1',
    'message.voice:reply:v1'
  ]);
  assert.deepEqual(progress, ['start', 'stop']);
  assert.match(String(deliveries[0].text), /I went home/);
});

test('voice conversation blocks before Telegram file download and AI', async () => {
  let downloads = 0;
  let effects = 0;
  let progressCalls = 0;
  const handler = createVoiceConversationHandler({
    async withProgress(_update, operation) {
      progressCalls += 1;
      return operation();
    },
    pool: unusedPool,
    webappUrl: 'https://example.test/app',
    getBotLocale: () => ({}),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async sendTelegramVoiceMessage() { return { message_id: 2 }; },
      async downloadTelegramFile() {
        downloads += 1;
        return Buffer.from('voice');
      },
      async callTelegramApi() { return {}; }
    },
    ai: unusedAi,
    quotaGuard: async () => ({
      allowed: false,
      context: statsContext({ limitReached: true, remainingSeconds: 0 }),
      outcome: { status: 'delivered', telegramMessageId: 92 }
    }),
    effectRunner: async <T extends Record<string, unknown>>() => {
      effects += 1;
      return { duplicate: false, result: {} as T };
    }
  });

  assert.deepEqual(await handler.execute(preparedVoice(9354)), {
    status: 'delivered',
    telegramMessageId: 92
  });
  assert.equal(downloads, 0);
  assert.equal(effects, 0);
  assert.equal(progressCalls, 0);
});

test('invalid voice duration is delivered before starting progress', async () => {
  const update = preparedVoice(9355);
  update.input.message.voiceDuration = 0;
  let progressCalls = 0;
  let quotaCalls = 0;
  const handler = createVoiceConversationHandler({
    async withProgress(_update, operation) {
      progressCalls += 1;
      return operation();
    },
    pool: unusedPool,
    webappUrl: 'https://example.test/app',
    getBotLocale: () => ({ msg_too_short: 'Too short' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async sendTelegramVoiceMessage() { return { message_id: 2 }; },
      async downloadTelegramFile() { return Buffer.from('voice'); },
      async callTelegramApi() { return {}; }
    },
    ai: unusedAi,
    quotaGuard: async () => {
      quotaCalls += 1;
      return allowPracticeQuota();
    },
    textDeliverer: async () => ({ status: 'delivered', telegramMessageId: 93 })
  });

  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 93
  });
  assert.equal(quotaCalls, 0);
  assert.equal(progressCalls, 0);
});

test('voice conversation skips TTS when inbound usage consumes final quota', async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  let quotaCalls = 0;
  let speechCalls = 0;
  const handler = createVoiceConversationHandler({
    presentation: {
      async initialize() {},
      async hasVoice() { return false; },
      async mutate() { throw new Error('unexpected audio attachment'); }
    },
    pool: unusedPool,
    webappUrl: 'https://example.test/app',
    getBotLocale: () => ({ user_text_prefix_multiline: 'You said:\n' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async sendTelegramVoiceMessage() { return { message_id: 2 }; },
      async downloadTelegramFile() { return Buffer.from('voice'); },
      async callTelegramApi() { return {}; }
    },
    ai: {
      ...unusedAi,
      async speech() {
        speechCalls += 1;
        return Buffer.from('speech');
      }
    },
    quotaGuard: async (input) => {
      quotaCalls += 1;
      if (quotaCalls === 1) return { allowed: true, context: statsContext() };
      await input.beforeBlockedDelivery?.();
      return {
        allowed: false,
        context: statsContext({ limitReached: true, remainingSeconds: 0 }),
        outcome: { status: 'delivered', telegramMessageId: 93 }
      };
    },
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: {
        transcript: 'I went home.',
        assistantMessageId: 557,
        replyMode: 'voice',
        response: {
          detected_language: 'en',
          is_target_language: true,
          has_mistakes: false,
          reply_text: 'What did you do there?',
          explanation_html: '<b>Good</b>'
        }
      } as unknown as T
    }),
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: deliveries.length };
    }
  });

  assert.deepEqual(await handler.execute(preparedVoice(9355)), {
    status: 'delivered',
    telegramMessageId: 93
  });
  assert.equal(quotaCalls, 2);
  assert.equal(speechCalls, 0);
  assert.deepEqual(deliveries.map((item) => item.stepKey), [
    'message.voice:transcript:v1',
    'message.voice:reply:v1'
  ]);
});

test('ambiguous Telegram timeout becomes unknown and is never retryable', async () => {
  const classified = classifyTelegramDeliveryError(
    Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })
  );
  assert.equal(classified.kind, 'unknown');

  const transitions: string[] = [];
  const execute = () => deliverTelegramText({
    pool: unusedPool, update: preparedStats(), stepKey:'test:timeout', text:'Test',
    telegramClient:{async sendTelegramTextMessage(){throw Object.assign(new Error('request timed out'),{code:'ETIMEDOUT'});}},
    deliveryRepository:{begin:async()=>({action:'send',deliveryId:'1',attempts:1}),
      markDelivered:async()=>{transitions.push('delivered');},markFailed:async()=>{transitions.push('failed');},markUnknown:async()=>{transitions.push('unknown');}}
  });

  await assert.rejects(
    execute,
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
  const handler: BotHandler<'command.unknown'> = {
    route: 'command.unknown',
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

test('pre-rollout command and preference jobs are retired without database writes or Telegram calls', async () => {
  for (const route of ['command.settings','command.level','command.voice','command.lang','command.stats','command.feedback','command.xp','command.progress','callback.level','callback.reply','callback.lang','reply_keyboard.voice_toggle']) {
    const contract = {...preparedStats(),route};
    const result=await processBotUpdateJob({id:'legacy',data:{contract,handlerVersion:1}}, {
      pool:{} as Pool,registry:{get(){throw new Error('retired jobs must not reach handlers');}},
      executionRepository:{claim:async()=>{throw new Error('retired jobs must not claim or mutate');},markSucceeded:async()=>{throw new Error('unexpected');},markFailed:async()=>{throw new Error('unexpected');}}
    });
    assert.equal(result,'retired_job',route);
  }
});

for (const [route, data, stepKey] of [
  ['callback.translate', 'tr:123:001', 'callback.translate:state:v1'],
  ['callback.hints', 'hint:123:100', 'callback.hints:state:v1']
] as const) {
  test(`support ${route} acknowledges first and reads owned cached content without AI`, async () => {
    const update = preparedCallback(route, data, 9490);
    const calls: string[] = [];
    const markups: unknown[] = [];
    const client = { async query(sql: string, params: unknown[]) {
      calls.push('owned-cache');
      assert.match(sql, /m\.chat_id = \$1/);
      assert.match(sql, /m\.bot_key = \$2/);
      assert.match(sql, /m\.role = 'assistant'/);
      assert.match(sql, /m\.id = \$3/);
      assert.deepEqual(params, [42, 'uk-en', 123]);
      return { rows: [{ content: 'Hello', translation_base: 'Привіт',
        follow_up_hints: JSON.stringify({ question: 'How are you?', useful_phrases: [] }) }] };
    } } as unknown as PoolClient;
    const handlers = createSupportCallbackHandlers({
      pool: unusedPool, getBotLocale: () => ({}), ai: unusedAi,
      effectRunner: async (_pool, { execute, stepKey: actual }) => {
        assert.equal(actual, stepKey);
        return { duplicate: false, result: await execute(client) };
      },
      telegramClient: {
        async callTelegramApi() { throw new Error('unexpected API call'); },
        async sendTelegramTextMessage() { throw new Error('unexpected direct send'); },
        async answerTelegramCallbackQuery() { calls.push('ack'); throw new Error('expired callback'); },
        async editTelegramMessageText(_chat, _id, text, options) {
          calls.push('edit'); assert.match(text, /Привіт/); markups.push(options?.replyMarkup);
        },
        async editTelegramMessageReplyMarkup(_chat, _id, markup) { calls.push('mark'); markups.push(markup); }
      },
      textDeliverer: async ({ text, stepKey }) => {
        calls.push('deliver'); assert.equal(stepKey, 'callback.hints:message:v1');
        assert.match(text, /How are you/); return { status: 'delivered', telegramMessageId: 10 };
      }
    });
    await handlers.find(handler => handler.route === route)!.execute(update);
    assert.deepEqual(calls, route === 'callback.translate' ? ['ack', 'owned-cache', 'edit'] : ['ack', 'owned-cache', 'deliver', 'mark']);
    const buttons = (markups[0] as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard.flat();
    assert.equal(buttons[0].callback_data, 'busy:1');
    assert.equal(buttons[route === 'callback.translate' ? 1 : 2].callback_data, 'busy:1');
  });
}

test('support acknowledges an unowned assistant callback then rejects permanently before AI or presentation', async () => {
  const update = preparedCallback('callback.translate', 'tr:123:000', 9491);
  const calls: string[] = [];
  const handler = createSupportCallbackHandlers({
    pool: unusedPool, ai: unusedAi, getBotLocale: () => ({}),
    effectRunner: async (_pool, { execute }) => ({ duplicate: false, result: await execute({
      async query() { calls.push('ownership'); return { rows: [] }; }
    } as unknown as PoolClient) }),
    telegramClient: {
      async callTelegramApi() { throw new Error('unexpected API call'); },
      async sendTelegramTextMessage() { throw new Error('unexpected send'); },
      async answerTelegramCallbackQuery() { calls.push('ack'); },
      async editTelegramMessageText() { throw new Error('unowned message must not be edited'); }
    }
  }).find(handler => handler.route === update.route)!;
  await assert.rejects(handler.execute(update), error => error instanceof BotRuntimeHandlerError
    && error.code === 'assistant_message_not_found' && !error.retryable);
  assert.deepEqual(calls, ['ack', 'ownership']);
});

test('transcript translation retains its text-only effect without assistant ownership or presentation', async () => {
  const update = preparedCallback('callback.transcript_translate', 'trv:not-an-assistant-id', 9492);
  update.input.callbackQuery!.messageText = 'You said:\nI work here.';
  const calls: string[] = [];
  const handler = createSupportCallbackHandlers({
    pool: unusedPool, getBotLocale: () => ({ user_text_prefix_multiline: 'You said:\n' }),
    ai: { async translate(botKey, text, trace) {
      calls.push('translate'); assert.equal(botKey, 'uk-en'); assert.equal(text, 'I work here.');
      assert.equal(trace?.decisionId, update.decisionId); return 'Я тут працюю.';
    } } as BotAiClient,
    effectRunner: async (_pool, { stepKey, execute }) => {
      assert.equal(stepKey, 'callback.transcript_translate:ai:v1');
      return { duplicate: false, result: await execute(null as unknown as PoolClient) };
    },
    telegramClient: {
      async callTelegramApi() { throw new Error('unexpected API call'); },
      async sendTelegramTextMessage() { throw new Error('unexpected send'); },
      async answerTelegramCallbackQuery() { calls.push('ack'); },
      async editTelegramMessageText(_chat, _id, text, options) {
        calls.push('edit'); assert.match(text, /You said:\nI work here\./); assert.match(text, /Я тут працюю/);
        assert.equal((options?.replyMarkup as any).inline_keyboard[0][0].callback_data, 'busy:1');
      }
    }
  }).find(handler => handler.route === update.route)!;
  assert.deepEqual(await handler.execute(update), { status: 'noop' });
  assert.deepEqual(calls, ['ack', 'translate', 'edit']);
});
