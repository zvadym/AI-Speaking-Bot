import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import type { BotAiClient, ConversationAiResult } from '../src/bot-runtime/bot-ai.js';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import { BotRuntimeHandlerError, type BotHandlerOutcome } from '../src/bot-runtime/handler-registry.js';
import { createBotPipelineRunner } from '../src/bot-runtime/pipeline.js';
import { createProgressIndicatorMiddleware } from '../src/bot-runtime/progress-middleware.js';
import type { runBotUpdateEffect } from '../src/bot-runtime/effect-repository.js';
import type { EntitlementContext } from '../src/bot-runtime/entitlement-context.js';
import { createTextConversationHandler } from '../src/bot-runtime/handlers/conversation.js';
import { createVoiceConversationHandler } from '../src/bot-runtime/handlers/voice.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { messageUpdate, voice } from './fixtures/telegram-updates.js';

const response: ConversationAiResult = {
  detected_language: 'en', is_target_language: true, has_mistakes: false,
  reply_text: 'What did you do there?', explanation_html: ''
};

function harness({
  respond = async () => response,
  typing = 'ok',
  failTranscriptOnce = false,
  legacy = false,
  replyMode = 'text',
  speech = async () => { throw new Error('unexpected speech'); }
}: {
  respond?: BotAiClient['respond'];
  typing?: 'ok' | 'hang' | 'throw';
  failTranscriptOnce?: boolean;
  legacy?: boolean;
  replyMode?: string;
  speech?: BotAiClient['speech'];
} = {}) {
  const events: string[] = [];
  const signals: AbortSignal[] = [];
  const effects = new Map<string, Record<string, unknown>>();
  const deliveries = new Map<string, BotHandlerOutcome>();
  const legacyResult = { transcript: 'I went home.', assistantMessageId: 7, replyMode: 'text', response };
  if (legacy) effects.set('message.voice:conversation:v1', legacyResult);
  const client = {
    async query(sql: string) {
      if (sql.includes('FROM bot_update_effects')) {
        return { rows: legacy ? [{ result_json: legacyResult }] : [] };
      }
      if (sql.includes('FROM user_bots ub')) {
        return { rows: [{ level: 'a1', reply_mode: replyMode }] };
      }
      if (sql.includes('FROM messages')) return { rows: [] };
      if (sql.includes('INSERT INTO voice_usage_events')) events.push('usage');
      if (sql.includes('INSERT INTO messages')) {
        events.push(sql.includes("'assistant'") ? 'save-assistant' : 'save-user');
        return { rows: [{ id: '7' }] };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const effectRunner: typeof runBotUpdateEffect = async (_pool, input) => {
    const cached = effects.get(input.stepKey);
    if (cached) return { duplicate: true, result: cached as never };
    const result = await input.execute(client);
    effects.set(input.stepKey, result);
    return { duplicate: false, result };
  };
  const dependencies = {
    pool: null as unknown as Pool,
    webappUrl: 'https://example.test/app',
    getBotLocale: () => ({ user_text_prefix_multiline: 'You said:\n' }),
    quotaGuard: async () => ({ allowed: true as const, context: {} as EntitlementContext }),
    telegramClient: {
      async sendTelegramTextMessage() { throw new Error('unexpected direct delivery'); },
      async sendTelegramVoiceMessage() { throw new Error('unexpected voice delivery'); },
      async downloadTelegramFile() { events.push('download'); return Buffer.from('voice'); },
      callTelegramApi(_bot: string, _method: string, _body: unknown, options?: { signal?: AbortSignal }) {
        if (options?.signal) signals.push(options.signal);
        if (typing === 'throw') throw new Error('typing unavailable');
        if (typing === 'hang') return new Promise(() => {});
        return Promise.resolve({});
      }
    },
    ai: {
      async transcribe() { events.push('transcribe'); return 'I went home.'; },
      async respond(input: Parameters<BotAiClient['respond']>[0]) { events.push('respond'); return respond(input); },
      async translate() { throw new Error('unexpected translation'); },
      async hints() { throw new Error('unexpected hints'); },
      async vocabulary() { throw new Error('unexpected vocabulary'); },
      async speech(botKey, text, trace) { events.push('speech'); return speech(botKey, text, trace); }
    } satisfies BotAiClient,
    effectRunner,
    textDeliverer: async (input: { stepKey: string; text: string }) => {
      const cached = deliveries.get(input.stepKey);
      if (cached) return { ...cached, status: 'duplicate' as const };
      if (input.stepKey === 'message.voice:transcript:v1' && failTranscriptOnce) {
        failTranscriptOnce = false;
        throw new Error('temporary delivery failure');
      }
      const result = { status: 'delivered' as const, telegramMessageId: deliveries.size + 1 };
      deliveries.set(input.stepKey, result);
      events.push(input.stepKey);
      return result;
    }
  };
  const update = buildPreparedUpdate({
    botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ voice }))
  }) as PreparedUpdate & { route: 'message.voice' };
  return { dependencies, update, events, signals, effects, deliveries, client };
}

for (const inputMode of ['text', 'voice'] as const) {
  test(`${inputMode} input sends final text before TTS and attaches voice to that same message`, async () => {
    let finishSpeech!: (value: Buffer) => void;
    let speechStarted!: () => void;
    const started = new Promise<void>((resolve) => { speechStarted = resolve; });
    const speech = new Promise<Buffer>((resolve) => { finishSpeech = resolve; });
    const h = harness({ replyMode: 'voice', speech: async () => { speechStarted(); return speech; } });
    let initialized: { telegramMessageId: number } | undefined;
    const attached: Array<{ telegramMessageId: number }> = [];
    let ready = false;
    const dependencies = { ...h.dependencies, presentation: {
      async initialize(key: { telegramMessageId: number }) { initialized = key; },
      async hasVoice() { return ready; },
      async mutate(key: { telegramMessageId: number }, mutation: { audio?: Buffer }) {
        if (!ready) assert.equal(mutation.audio?.toString(), 'ogg');
        attached.push(key); ready = true; return true;
      }
    } };
    const execution = inputMode === 'voice'
      ? createVoiceConversationHandler(dependencies).execute(h.update)
      : createTextConversationHandler(dependencies).execute(buildPreparedUpdate({
          botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ text: 'Hello' }))
        }) as PreparedUpdate & { route: 'message.text' });
    await started;
    const delivery = h.deliveries.get(`message.${inputMode}:reply:v1`);
    assert.ok(delivery?.telegramMessageId);
    assert.equal(initialized?.telegramMessageId, delivery.telegramMessageId);
    assert.equal(attached.length, 0);
    finishSpeech(Buffer.from('ogg'));
    await execution;
    assert.equal(attached[0]?.telegramMessageId, delivery.telegramMessageId);
    assert.ok(h.events.indexOf(`message.${inputMode}:reply:v1`) < h.events.indexOf('speech'));
  });
}

test('voice transcript is committed and delivered while the tutor is still pending', async () => {
  let finish!: (result: ConversationAiResult) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const pending = new Promise<ConversationAiResult>((resolve) => { finish = resolve; });
  const h = harness({ respond: async () => { began(); return pending; } });
  const execution = createVoiceConversationHandler(h.dependencies).execute(h.update);
  await started;
  assert.deepEqual(h.events, ['download', 'transcribe', 'message.voice:transcript:v1', 'respond']);
  assert.ok(h.effects.has('message.voice:transcription:v1'));
  assert.ok(!h.effects.has('message.voice:conversation:v1'));
  finish(response);
  await execution;
  assert.equal(h.events.at(-1), 'message.voice:reply:v1');
});

for (const duration of [1, 40, 41, 90]) {
  test(`voice duration ${duration}s is accepted with a length tip only above 40s`, async () => {
    const h = harness();
    h.update.input.message.voiceDuration = duration;
    await createVoiceConversationHandler(h.dependencies).execute(h.update);
    assert.ok(h.events.includes('transcribe'));
    assert.ok(h.events.includes('respond'));
    const tip = h.events.indexOf('message.voice:length-tip:v1');
    assert.equal(tip >= 0, duration > 40);
    if (duration > 40) assert.ok(tip < h.events.indexOf('download'));
  });
}

for (const duration of [0, 91]) {
  test(`voice duration ${duration}s is rejected before quota, advice, or AI`, async () => {
    const h = harness();
    h.update.input.message.voiceDuration = duration;
    let quotaCalls = 0;
    await createVoiceConversationHandler({
      ...h.dependencies,
      quotaGuard: async () => {
        quotaCalls++;
        return { allowed: true, context: {} as EntitlementContext };
      }
    }).execute(h.update);
    assert.deepEqual(h.events, [duration === 0 ? 'message.voice:too-short:v1' : 'message.voice:too-long:v1']);
    assert.equal(quotaCalls, 0);
  });
}

test('long voice advice uses the localized text and is not repeated after generation retry', async () => {
  let attempts = 0;
  const h = harness({ respond: async () => {
    if (++attempts === 1) throw new Error('temporary AI failure');
    return response;
  } });
  h.update.input.message.voiceDuration = 90;
  const deliveredTexts: string[] = [];
  const handler = createVoiceConversationHandler({
    ...h.dependencies,
    getBotLocale: () => ({ msg_voice_length_tip: 'Спробуй 30–45 секунд.' }),
    textDeliverer: async (input) => {
      const result = await h.dependencies.textDeliverer(input);
      if (result.status === 'delivered') deliveredTexts.push(input.text);
      return result;
    }
  });
  await assert.rejects(handler.execute(h.update), /voice_conversation_failed/);
  await handler.execute(h.update);
  assert.equal(deliveredTexts.filter((text) => text === 'Спробуй 30–45 секунд.').length, 1);
  assert.equal(h.events.filter((event) => event === 'message.voice:length-tip:v1').length, 1);
  assert.equal(h.events.filter((event) => event === 'transcribe').length, 1);
  assert.equal(h.events.filter((event) => event === 'usage').length, 1);
});

test('exhausted practice quota blocks a long voice before advice or transcription', async () => {
  const h = harness();
  h.update.input.message.voiceDuration = 90;
  const result = await createVoiceConversationHandler({
    ...h.dependencies,
    quotaGuard: async () => ({
      allowed: false,
      context: {} as EntitlementContext,
      outcome: { status: 'delivered', telegramMessageId: 999 }
    })
  }).execute(h.update);
  assert.equal(result.telegramMessageId, 999);
  assert.deepEqual(h.events, []);
});

test('generation retry reuses transcription, avoids duplicate transcript, and accounts usage once', async () => {
  let attempts = 0;
  const h = harness({ respond: async () => {
    if (++attempts === 1) throw new Error('temporary AI failure');
    return response;
  } });
  const handler = createVoiceConversationHandler(h.dependencies);
  await assert.rejects(handler.execute(h.update), /voice_conversation_failed/);
  await handler.execute(h.update);
  await handler.execute(h.update);
  for (const event of ['download', 'transcribe', 'message.voice:transcript:v1', 'usage', 'save-user', 'save-assistant']) {
    assert.equal(h.events.filter((value) => value === event).length, 1, event);
  }
  assert.equal(attempts, 2);
});

test('transcript delivery failure retries before tutor generation without repeating STT', async () => {
  const h = harness({ failTranscriptOnce: true });
  const handler = createVoiceConversationHandler(h.dependencies);
  await assert.rejects(handler.execute(h.update));
  assert.ok(!h.events.includes('respond'));
  await handler.execute(h.update);
  assert.equal(h.events.filter((event) => event === 'transcribe').length, 1);
  assert.ok(h.events.indexOf('message.voice:transcript:v1') < h.events.indexOf('respond'));
});

test('completed combined effects from an older worker do not trigger STT or generation again', async () => {
  const h = harness({ legacy: true });
  await createVoiceConversationHandler(h.dependencies).execute(h.update);
  assert.deepEqual(h.events, ['message.voice:transcript:v1', 'message.voice:reply:v1']);
});

for (const mode of ['text', 'voice'] as const) {
  for (const typing of ['hang', 'throw'] as const) {
    test(`${mode} processing completes independently of ${typing} typing`, { timeout: 2000 }, async () => {
      const h = harness({ typing });
      let deadline: NodeJS.Timeout | undefined;
      const execution = mode === 'voice'
        ? createVoiceConversationHandler(h.dependencies).execute(h.update)
        : createTextConversationHandler(h.dependencies).execute(buildPreparedUpdate({
            botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ text: 'Hello' }))
          }) as PreparedUpdate & { route: 'message.text' });
      try {
        await Promise.race([
          execution,
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error('typing blocked processing')), 250);
          })
        ]);
      } finally {
        clearTimeout(deadline);
      }
      assert.ok(h.events.includes('respond'));
      assert.ok(h.signals.length > 0);
      if (typing === 'hang') {
        await Promise.all(h.signals.map((signal) => signal.aborted ? undefined : new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        })));
        assert.ok(h.signals.every((signal) => signal.aborted));
      }
    });
  }
}

for (const mode of ['text', 'voice'] as const) {
  test(`${mode} language mismatch stops before reply delivery and TTS`, async () => {
    const h = harness({ replyMode: 'voice', respond: async () => ({
      ...response, is_target_language: false, reply_text: '', explanation_html: '<b>Try English.</b>'
    }) });
    const handler = mode === 'text'
      ? createTextConversationHandler(h.dependencies)
      : createVoiceConversationHandler(h.dependencies);
    const update = mode === 'text'
      ? buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ text: 'Привіт' })) })
      : h.update;
    await handler.execute(update as never);
    assert.ok(h.deliveries.has(`message.${mode}:language-mismatch:v1`));
    assert.ok(!h.deliveries.has(`message.${mode}:reply:v1`));
    assert.ok(!h.events.includes('speech'));
    assert.ok(!h.events.includes('save-assistant'));
  });

  test(`${mode} graph preserves typed generation errors and stops draft before progress cleanup`, async () => {
    const failure = new BotRuntimeHandlerError('invalid_tutor_state', { retryable: false });
    const h = harness({ respond: async (input) => {
      input.onReplyText?.('Disposable preview');
      await Promise.resolve();
      throw failure;
    } });
    let draftSignal: AbortSignal | undefined;
    let draftUpdate: ((text: string) => void) | undefined;
    let draftCalls = 0;
    let progressStopped = false;
    const dependencies = {
      ...h.dependencies,
      ai: { ...h.dependencies.ai, async respond(input: Parameters<BotAiClient['respond']>[0]) {
        draftUpdate = input.onReplyText;
        return h.dependencies.ai.respond(input);
      } },
      telegramClient: { ...h.dependencies.telegramClient,
        async callTelegramApi(_bot: string, method: string, _body: unknown, options?: { signal?: AbortSignal }) {
          if (method === 'sendMessageDraft') {
            draftCalls++;
            draftSignal = options?.signal;
            // Model a preview request that finishes only when the draft stops.
            await new Promise<void>((resolve) => options?.signal?.addEventListener('abort', () => resolve(), { once: true }));
          }
          return {};
        }
      }
    };
    const runner = createBotPipelineRunner([createProgressIndicatorMiddleware({
      getBotLocale: dependencies.getBotLocale,
      enabledBotKeys: new Set(['uk-en']),
      progressService: {
        async start() { return { sessionId: 'test-session', messageId: 999 }; },
        async stop() { assert.equal(draftSignal?.aborted, true); progressStopped = true; return true; },
        async rotate() { throw new Error('unexpected rotation'); },
        async timeout() { throw new Error('unexpected timeout'); }
      }
    })]);
    const handler = mode === 'text'
      ? createTextConversationHandler(dependencies)
      : createVoiceConversationHandler(dependencies);
    const update = mode === 'text'
      ? buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ text: 'Hello' })) })
      : h.update;
    await assert.rejects(runner.execute({ handler, update, jobId: 'test-job', attempt: 1 }), (error: unknown) => {
      assert.equal(error, failure);
      assert.equal((error as BotRuntimeHandlerError).retryable, false);
      return true;
    });
    assert.equal(progressStopped, true);
    assert.equal(draftCalls, 1);
    draftUpdate?.('Must stay stopped');
    await Promise.resolve();
    assert.equal(draftCalls, 1);
    assert.ok(!h.deliveries.has(`message.${mode}:reply:v1`));
  });

  test(`${mode} shared graph isolates parallel updates, pipeline contexts and draft callbacks`, async () => {
    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ respond: async (input) => {
      assert.equal(input.trace?.chatId, input.text === 'first' ? 101 : 102);
      input.onReplyText?.(`preview ${input.text}`);
      if (++started === 2) release();
      await barrier;
      return { ...response, reply_text: `reply ${input.text}` };
    } });
    const previews: Array<Record<string, unknown>> = [];
    const deliveries: Array<{ chatId: number | null; text: string }> = [];
    const dependencies = {
      ...h.dependencies,
      ai: { ...h.dependencies.ai, async transcribe(_bot: string, audio: Buffer) { return audio.toString(); } },
      telegramClient: { ...h.dependencies.telegramClient,
        async downloadTelegramFile(fileId: string) { return Buffer.from(fileId); },
        async callTelegramApi(_bot: string, method: string, body: Record<string, unknown>) {
          if (method === 'sendMessageDraft') previews.push(body);
          return {};
        }
      },
      effectRunner: (async (_pool, input) => ({ duplicate: false, result: await input.execute(h.client) })) as typeof runBotUpdateEffect,
      async textDeliverer(input: { update: PreparedUpdate; stepKey: string; text: string }) {
        if (input.stepKey.endsWith(':reply:v1')) deliveries.push({ chatId: input.update.input.chatId, text: input.text });
        return { status: 'delivered' as const, telegramMessageId: input.update.updateId };
      }
    };
    const contexts: number[] = [];
    const runner = createBotPipelineRunner([{
      name: 'isolation-check',
      async aroundStage(context, stage, next) {
        assert.equal(stage, 'conversation.generate');
        assert.equal(context.state.size, 0);
        context.state.set('chat', context.update.input.chatId);
        contexts.push(context.update.input.chatId as number);
        const result = await next();
        assert.equal(context.state.get('chat'), context.update.input.chatId);
        return result;
      }
    }]);
    const handler = mode === 'text'
      ? createTextConversationHandler(dependencies)
      : createVoiceConversationHandler(dependencies);
    const updates = ['first', 'second'].map((text, index) => buildPreparedUpdate({
      botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({
        updateId: 7000 + index, chatId: 101 + index,
        ...(mode === 'text' ? { text } : { voice: { ...voice, file_id: text } })
      }))
    }));
    await Promise.all(updates.map((update) => runner.execute({ handler, update, jobId: String(update.updateId), attempt: 1 })));
    assert.deepEqual(contexts.sort(), [101, 102]);
    assert.deepEqual(deliveries.sort((a, b) => Number(a.chatId) - Number(b.chatId)), [
      { chatId: 101, text: 'reply first' }, { chatId: 102, text: 'reply second' }
    ]);
    assert.deepEqual(previews.map(({ chat_id, text }) => ({ chat_id, text })).sort((a, b) => Number(a.chat_id) - Number(b.chat_id)), [
      { chat_id: 101, text: 'preview first' }, { chat_id: 102, text: 'preview second' }
    ]);
  });
}
