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
} from '../src/bot-runtime/ingestion-service.js';
import {
  classifyTelegramDeliveryError,
  createStatsHandler
} from '../src/bot-runtime/handlers/stats.js';
import { createPreferenceHandlers } from '../src/bot-runtime/handlers/preferences.js';
import { createFeedbackHandlers } from '../src/bot-runtime/handlers/feedback.js';
import { createCallbackActionHandlers } from '../src/bot-runtime/handlers/callback-actions.js';
import { createSupportCallbackHandlers } from '../src/bot-runtime/handlers/support-callbacks.js';
import { createTextConversationHandler } from '../src/bot-runtime/handlers/conversation.js';
import { createVoiceConversationHandler } from '../src/bot-runtime/handlers/voice.js';
import type { BotAiClient } from '../src/bot-runtime/bot-ai.js';
import {
  createTopicActionHandler,
  createTopicMenuHandler
} from '../src/bot-runtime/handlers/topic-menu.js';
import { buildStaticRouteMessage } from '../src/bot-runtime/handlers/static-routes.js';
import { processBotUpdateJob } from '../src/bot-runtime/register-worker.js';
import type { BotPipelineContext } from '../src/bot-runtime/pipeline.js';
import {
  BOT_RUNTIME_HANDLER_VERSIONS,
  parseBotRuntimeRouteFlags
} from '../src/bot-runtime/route-flags.js';
import { ROUTES } from '../src/bot-runtime/contracts.js';
import type { StatsContext } from '../src/bot-runtime/stats-context.js';
import { buildStatsMessage } from '../src/bot-runtime/stats-message.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { buildRetiredCommandMessage } from '../src/bot-runtime/handlers/retired-commands.js';
import { callbackUpdate, messageUpdate, voice } from './fixtures/telegram-updates.js';

const unusedPool = null as unknown as Pool;

function preparedStats(updateId = 9001): PreparedUpdate & { route: 'command.stats' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: '/stats' }))
  });
  assert.equal(prepared.route, 'command.stats');
  return prepared as PreparedUpdate & { route: 'command.stats' };
}

function preparedReplyCallback(updateId = 9101): PreparedUpdate & { route: 'callback.reply' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(callbackUpdate({ updateId, data: 'reply:text' }))
  });
  assert.equal(prepared.route, 'callback.reply');
  return prepared as PreparedUpdate & { route: 'callback.reply' };
}

function preparedTopic(updateId = 9201): PreparedUpdate & { route: 'command.topic' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: '/topic' }))
  });
  assert.equal(prepared.route, 'command.topic');
  return prepared as PreparedUpdate & { route: 'command.topic' };
}

function preparedFeedback(updateId = 9301): PreparedUpdate & { route: 'command.feedback' } {
  const prepared = buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({
      updateId,
      text: '/feedback Useful bot'
    }))
  });
  assert.equal(prepared.route, 'command.feedback');
  return prepared as PreparedUpdate & { route: 'command.feedback' };
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
    () => parseBotRuntimeRouteFlags('{"uk-en":["not-a-route"]}', ['uk-en']),
    /unknown route/
  );
  assert.throws(
    () => parseBotRuntimeRouteFlags('{"uk-en":"command.stats"}', ['uk-en']),
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

test('retired command reply preserves language controls without progress', () => {
  const update = preparedStats();
  const message = buildRetiredCommandMessage(update, { msg_error_command: 'Unknown command' });
  assert.equal(message.text, 'Unknown command');
  assert.deepEqual(message.replyMarkup.keyboard, [[{ text: update.context.keyboard.settingsButtonText }]]);
  assert.doesNotMatch(JSON.stringify(message), /XP/);
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

test('preference callbacks reuse the persisted effect result and confirm once', async () => {
  const update = preparedReplyCallback();
  const callbackCalls: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handler = createPreferenceHandlers({
    pool: unusedPool,
    getBotLocale: () => ({
      callback_saved: 'Saved',
      reply_mode_saved_prefix: 'Mode: ',
      reply_mode_text: 'text',
      keyboard_btn_topic_none: 'Free chat',
      keyboard_btn_voice_text: 'Text',
      keyboard_btn_voice_voice: 'Voice',
      keyboard_btn_xp_prefix: 'XP'
    }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async answerTelegramCallbackQuery(callbackId) {
        callbackCalls.push(`answer:${callbackId}`);
        return true;
      },
      async deleteTelegramMessage(_chatId, messageId) {
        callbackCalls.push(`delete:${messageId}`);
        return true;
      }
    },
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: { replyMode: 'text' } as unknown as T
    }),
    keyboardStateLoader: async () => ({
      level: 'b1',
      reply_mode: 'text',
      onboarding_complete_at: new Date(),
      topic_enabled: false,
      xp_total: 25,
      xp_level: 1
    }),
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 22 };
    }
  }).find((candidate) => candidate.route === 'callback.reply');
  assert.ok(handler);

  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 22
  });
  assert.deepEqual(callbackCalls, [
    `answer:${update.input.callbackQuery?.id}`,
    `delete:${update.input.callbackQuery?.messageId}`
  ]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].text, 'Mode: text');
  assert.equal(deliveries[0].stepKey, 'callback.reply:confirmation:v1');
});

test('topic menu reloads current tier and state before formatting', async () => {
  const update = preparedTopic();
  const deliveries: Array<Record<string, unknown>> = [];
  const pool = {
    async query() {
      return {
        rows: [{
          topic_enabled: true,
          topic_template_id: 'travel',
          topic_pack_json: { title_base: 'My trip' }
        }]
      };
    }
  } as unknown as Pool;
  const handler = createTopicMenuHandler({
    pool,
    getBotLocale: () => ({
      topic_menu_title: 'Topics',
      topic_menu_current_prefix: 'Current: ',
      topic_menu_current_none: 'None'
    }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; }
    },
    helpers: {
      async fetchEffectiveTierForChat() { return 'pro'; },
      async fetchTopicCatalogRows() {
        return [{ topic_id: 'travel', title_base: 'Travel' }];
      },
      async fetchTopicCatalogItem() {
        return { topic_id: 'travel', title_base: 'Travel' };
      },
      normalizeTopicPackValue(value) {
        return value as Record<string, unknown>;
      },
      formatTopicMenuLabel(topic, _locale, options) {
        assert.equal(options.userTier, 'pro');
        return String(topic.title_base);
      },
      buildTopicMenuReplyMarkup(_catalog, _locale, options) {
        assert.equal(options.userTier, 'pro');
        return { inline_keyboard: [[{ text: 'Travel', callback_data: 'topic:travel' }]] };
      }
    },
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 44 };
    }
  });

  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 44
  });
  assert.equal(deliveries[0].text, 'Topics\n\nCurrent: My trip');
  assert.equal(deliveries[0].stepKey, 'command.topic:menu:v1');
});

test('static callback actions acknowledge once and use durable text delivery', async () => {
  const update = preparedCallback('callback.lang', 'lang:en');
  const acknowledgements: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handlers = createCallbackActionHandlers({
    pool: unusedPool,
    getBotLocale: () => ({ callback_saved: 'Saved' }),
    getBotConfig: () => ({ learning_language: 'en' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async answerTelegramCallbackQuery(_id, text) {
        acknowledgements.push(String(text));
      }
    },
    async sendIdiomMore() { return {}; },
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 71 };
    }
  });
  const handler = handlers.find((item) => item.route === 'callback.lang');
  assert.ok(handler);
  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 71
  });
  assert.deepEqual(acknowledgements, ['Saved']);
  assert.equal(deliveries[0].stepKey, 'callback.lang:message:v1');
  assert.match(String(deliveries[0].text), /EN/);
});

test('topic clear reuses effect state and restores the persistent keyboard', async () => {
  const update = preparedCallback('callback.topic', 'topic:clear', 9402);
  const telegramMethods: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handler = createTopicActionHandler({
    pool: unusedPool,
    getBotLocale: () => ({ topic_clear_done: 'Cleared' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; },
      async answerTelegramCallbackQuery() {},
      async callTelegramApi(_botKey, method) {
        telegramMethods.push(method);
        return {};
      }
    },
    helpers: {
      async fetchEffectiveTierForChat() { return 'free'; },
      async fetchTopicCatalogRows() { return []; },
      async fetchTopicCatalogItem() { return null; },
      normalizeTopicPackValue() { return null; },
      formatTopicMenuLabel() { return ''; },
      buildTopicMenuReplyMarkup() { return {}; }
    },
    effectRunner: async <T extends Record<string, unknown>>() => ({
      duplicate: true,
      result: { pinnedMessageId: 123 } as unknown as T
    }),
    keyboardStateLoader: async () => ({
      onboarding_complete_at: '2026-01-01T00:00:00Z',
      reply_mode: 'text'
    }),
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 72 };
    }
  });
  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 72
  });
  assert.deepEqual(telegramMethods, ['unpinChatMessage']);
  assert.equal(deliveries[0].stepKey, 'callback.topic:cleared-message:v1');
  assert.ok(deliveries[0].replyMarkup);
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
  const stages: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handler = createTextConversationHandler({
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
  const pipeline = {
    async runStage<T>(stage: string, operation: () => Promise<T>) {
      stages.push(stage);
      return operation();
    }
  } as BotPipelineContext;
  assert.deepEqual(await handler.execute(update, pipeline), {
    status: 'delivered',
    telegramMessageId: 2
  });
  assert.deepEqual(methods, ['sendChatAction']);
  assert.deepEqual(stages, ['conversation.generate']);
  assert.deepEqual(deliveries.map((item) => item.stepKey), [
    'message.text:correction:v1',
    'message.text:reply:v1'
  ]);
  assert.match(JSON.stringify(deliveries[1].replyMarkup), /tr:555:000/);
});

test('text conversation blocks before typing and AI when global quota is exhausted', async () => {
  const methods: string[] = [];
  let conversationEffects = 0;
  let stages = 0;
  const handler = createTextConversationHandler({
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

  const pipeline = {
    async runStage<T>(_stage: string, operation: () => Promise<T>) {
      stages += 1;
      return operation();
    }
  } as BotPipelineContext;
  assert.deepEqual(await handler.execute(preparedText(9353), pipeline), {
    status: 'delivered',
    telegramMessageId: 91
  });
  assert.deepEqual(methods, []);
  assert.equal(conversationEffects, 0);
  assert.equal(stages, 0);
});

test('voice conversation reuses STT state and delivers transcript before text reply', async () => {
  const update = preparedVoice();
  const deliveries: Array<Record<string, unknown>> = [];
  const stages: string[] = [];
  const pool = {
    async query() {
      return { rows: [{ limit_seconds: 0, used_seconds: 0 }] };
    }
  } as unknown as Pool;
  const handler = createVoiceConversationHandler({
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
  const pipeline = {
    async runStage<T>(stage: string, operation: () => Promise<T>) {
      stages.push(stage);
      return operation();
    }
  } as BotPipelineContext;
  assert.deepEqual(await handler.execute(update, pipeline), {
    status: 'delivered',
    telegramMessageId: 2
  });
  assert.deepEqual(deliveries.map((item) => item.stepKey), [
    'message.voice:transcript:v1',
    'message.voice:reply:v1'
  ]);
  assert.deepEqual(stages, ['conversation.generate']);
  assert.match(String(deliveries[0].text), /I went home/);
});

test('voice conversation blocks before Telegram file download and AI', async () => {
  let downloads = 0;
  let effects = 0;
  let stages = 0;
  const handler = createVoiceConversationHandler({
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

  const pipeline = {
    async runStage<T>(_stage: string, operation: () => Promise<T>) {
      stages += 1;
      return operation();
    }
  } as BotPipelineContext;
  assert.deepEqual(await handler.execute(preparedVoice(9354), pipeline), {
    status: 'delivered',
    telegramMessageId: 92
  });
  assert.equal(downloads, 0);
  assert.equal(effects, 0);
  assert.equal(stages, 0);
});

test('invalid voice duration is delivered before entering the conversation stage', async () => {
  const update = preparedVoice(9355);
  update.input.message.voiceDuration = 0;
  let stages = 0;
  let quotaCalls = 0;
  const handler = createVoiceConversationHandler({
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
  const pipeline = {
    async runStage<T>(_stage: string, operation: () => Promise<T>) {
      stages += 1;
      return operation();
    }
  } as BotPipelineContext;

  assert.deepEqual(await handler.execute(update, pipeline), {
    status: 'delivered',
    telegramMessageId: 93
  });
  assert.equal(quotaCalls, 0);
  assert.equal(stages, 0);
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

test('feedback command uses one effect and a durable confirmation delivery', async () => {
  const update = preparedFeedback();
  const effectSteps: string[] = [];
  const deliveries: Array<Record<string, unknown>> = [];
  const handler = createFeedbackHandlers({
    pool: unusedPool,
    getBotLocale: () => ({ msg_feedback_thanks: 'Received' }),
    telegramClient: {
      async sendTelegramTextMessage() { return { message_id: 1 }; }
    },
    effectRunner: async <T extends Record<string, unknown>>(
      _pool: Pool,
      input: {
        decisionId: string;
        stepKey: string;
        execute(client: PoolClient): Promise<T>;
      }
    ) => {
      effectSteps.push(input.stepKey);
      return {
        duplicate: false,
        result: { outcome: 'saved' } as unknown as T
      };
    },
    textDeliverer: async (input) => {
      deliveries.push(input as unknown as Record<string, unknown>);
      return { status: 'delivered', telegramMessageId: 55 };
    }
  }).find((candidate) => candidate.route === 'command.feedback');
  assert.ok(handler);

  assert.deepEqual(await handler.execute(update), {
    status: 'delivered',
    telegramMessageId: 55
  });
  assert.deepEqual(effectSteps, ['command.feedback:state:v1']);
  assert.equal(deliveries[0].text, 'Received');
  assert.equal(deliveries[0].stepKey, 'command.feedback:saved:v1');
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
