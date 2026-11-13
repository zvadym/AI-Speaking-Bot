import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import type { BotHandler } from '../src/bot-runtime/handler-registry.js';
import { createBotPipelineRunner } from '../src/bot-runtime/middleware/pipeline.js';
import { parseProgressEnabledBotKeys } from '../src/bot-runtime/middleware/progress-config.js';
import { createProgressIndicatorMiddleware } from '../src/bot-runtime/middleware/progress-middleware.js';
import type { ProgressService } from '../src/bot-runtime/middleware/progress-service.js';

function update(route: 'message.text' | 'message.voice' | 'command.unknown' = 'message.text') {
  return {
    contractVersion: 1,
    decisionId: 'v1:uk-de:8101',
    botKey: 'uk-de',
    updateId: 8101,
    route,
    input: { chatId: 8101 }
  } as PreparedUpdate;
}

function harness(options: { startError?: Error; stopError?: Error } = {}) {
  const events: string[] = [];
  const errors: Array<{ event: string; error: unknown }> = [];
  const service = {
    async start() {
      events.push('progress:start');
      if (options.startError) throw options.startError;
      return { sessionId: 'session-1', messageId: 44 };
    },
    async stop(input: { sessionId?: string | null }) {
      events.push(`progress:stop:${input.sessionId}`);
      if (options.stopError) throw options.stopError;
      return true;
    },
    async rotate() { return true; },
    async timeout() { return true; }
  } as ProgressService;
  const middleware = createProgressIndicatorMiddleware({
    progressService: service,
    getBotLocale: () => ({
      waiting_text: 'Waiting',
      loader_messages: ['Still working']
    }),
    enabledBotKeys: new Set(['uk-de']),
    reportError(error, event) { errors.push({ event, error }); }
  });
  return { events, errors, middleware };
}

function stageHandler(
  events: string[],
  route: 'message.text' | 'message.voice' | 'command.unknown' = 'message.text',
  stage = 'conversation.generate',
  operationError: Error | null = null
): BotHandler {
  return {
    route,
    version: 1,
    async execute(_update, pipeline) {
      return pipeline!.runStage(stage, async () => {
        events.push('operation');
        if (operationError) throw operationError;
        return { status: 'noop' as const };
      });
    }
  } as BotHandler;
}

test('progress config supports empty, explicit, and all-bot activation', () => {
  const known = ['uk-de', 'uk-en'];
  assert.deepEqual([...parseProgressEnabledBotKeys('', known)], []);
  assert.deepEqual([...parseProgressEnabledBotKeys('uk-de, uk-de', known)], ['uk-de']);
  assert.deepEqual([...parseProgressEnabledBotKeys('*', known)], known);
  assert.throws(
    () => parseProgressEnabledBotKeys('missing-bot', known),
    /unknown_progress_bot_key:missing-bot/
  );
});

test('progress middleware surrounds the conversation stage and stops before return', async () => {
  const { events, middleware } = harness();
  const result = await createBotPipelineRunner([middleware]).execute({
    handler: stageHandler(events),
    update: update(),
    jobId: '00000000-0000-4000-8000-000000000001',
    attempt: 1
  });

  assert.deepEqual(result, { status: 'noop' });
  assert.deepEqual(events, ['progress:start', 'operation', 'progress:stop:session-1']);
});

test('progress middleware stops after stage failure and preserves the original error', async () => {
  const { events, middleware } = harness();
  const failure = new Error('generation failed');
  await assert.rejects(
    () => createBotPipelineRunner([middleware]).execute({
      handler: stageHandler(events, 'message.text', 'conversation.generate', failure),
      update: update(),
      jobId: '00000000-0000-4000-8000-000000000002',
      attempt: 1
    }),
    failure
  );
  assert.deepEqual(events, ['progress:start', 'operation', 'progress:stop:session-1']);
});

test('progress start and stop failures remain best-effort', async () => {
  const startFailure = harness({ startError: new Error('start unavailable') });
  assert.deepEqual(await createBotPipelineRunner([startFailure.middleware]).execute({
    handler: stageHandler(startFailure.events),
    update: update(),
    jobId: '00000000-0000-4000-8000-000000000003',
    attempt: 1
  }), { status: 'noop' });
  assert.deepEqual(startFailure.events, ['progress:start', 'operation']);
  assert.deepEqual(startFailure.errors.map((item) => item.event), ['start']);

  const stopFailure = harness({ stopError: new Error('stop unavailable') });
  assert.deepEqual(await createBotPipelineRunner([stopFailure.middleware]).execute({
    handler: stageHandler(stopFailure.events),
    update: update(),
    jobId: '00000000-0000-4000-8000-000000000004',
    attempt: 1
  }), { status: 'noop' });
  assert.deepEqual(stopFailure.events, [
    'progress:start',
    'operation',
    'progress:stop:session-1'
  ]);
  assert.deepEqual(stopFailure.errors.map((item) => item.event), ['stop']);
});

test('progress middleware ignores commands, unrelated stages, and disabled bots', async () => {
  const command = harness();
  await createBotPipelineRunner([command.middleware]).execute({
    handler: stageHandler(command.events, 'command.unknown'),
    update: update('command.unknown'),
    jobId: '00000000-0000-4000-8000-000000000005',
    attempt: 1
  });
  assert.deepEqual(command.events, ['operation']);

  const otherStage = harness();
  await createBotPipelineRunner([otherStage.middleware]).execute({
    handler: stageHandler(otherStage.events, 'message.text', 'delivery.send'),
    update: update(),
    jobId: '00000000-0000-4000-8000-000000000006',
    attempt: 1
  });
  assert.deepEqual(otherStage.events, ['operation']);

  const disabledEvents: string[] = [];
  const disabledService = {
    async start() { disabledEvents.push('start'); return { sessionId: 'x', messageId: 1 }; },
    async stop() { disabledEvents.push('stop'); return true; },
    async rotate() { return true; },
    async timeout() { return true; }
  } as ProgressService;
  const disabled = createProgressIndicatorMiddleware({
    progressService: disabledService,
    getBotLocale: () => ({}),
    enabledBotKeys: new Set()
  });
  await createBotPipelineRunner([disabled]).execute({
    handler: stageHandler(disabledEvents),
    update: update(),
    jobId: '00000000-0000-4000-8000-000000000007',
    attempt: 1
  });
  assert.deepEqual(disabledEvents, ['operation']);
});
