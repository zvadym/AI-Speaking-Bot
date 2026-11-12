import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import type {
  BotHandler,
  BotHandlerOutcome
} from '../src/bot-runtime/handler-registry.js';
import {
  createBotPipelineRunner,
  runBotPipelineStage,
  type BotPipelineMiddleware
} from '../src/bot-runtime/pipeline.js';

function preparedText(): PreparedUpdate & { route: 'message.text' } {
  return {
    contractVersion: 1,
    decisionId: 'v1:uk-de:7001',
    botKey: 'uk-de',
    updateId: 7001,
    route: 'message.text',
    input: {
      updateId: 7001,
      updateType: 'message',
      chatId: 7001,
      chatType: 'private',
      isPrivate: true,
      isGroup: false,
      sender: {
        id: 7001,
        isBot: false,
        username: null,
        firstName: 'Pipeline',
        lastName: null,
        languageCode: 'uk'
      },
      message: {
        id: 1,
        text: 'Hallo',
        hasText: true,
        hasVoice: false,
        voiceFileId: null,
        voiceDuration: null,
        isPinnedServiceUpdate: false
      },
      callbackQuery: null
    },
    routingFacts: {
      command: null,
      startPayload: '',
      callback: null,
      keyboardIntent: null,
      pendingFeedback: false,
      guard: null,
      intentSource: 'message'
    },
    context: {
      keyboard: {
        enabled: false,
        buttonIntent: null,
        levelValue: 'a1',
        voiceValue: 'text',
        replyMode: 'text',
        levelButtonText: '',
        voiceButtonText: ''
      }
    }
  };
}

function outcome(): BotHandlerOutcome {
  return { status: 'noop' };
}

test('pipeline composes handler and stage middleware with onion ordering', async () => {
  const events: string[] = [];
  const middleware = (name: string): BotPipelineMiddleware => ({
    name,
    async execute(_context, next) {
      events.push(`${name}:execute:before`);
      const result = await next();
      events.push(`${name}:execute:after`);
      return result;
    },
    async aroundStage(_context, stage, next) {
      events.push(`${name}:${stage}:before`);
      const result = await next();
      events.push(`${name}:${stage}:after`);
      return result;
    }
  });
  const handler: BotHandler<'message.text'> = {
    route: 'message.text',
    version: 1,
    async execute(_update, pipeline) {
      events.push('handler:before');
      await runBotPipelineStage(pipeline, 'conversation.generate', async () => {
        events.push('operation');
      });
      events.push('handler:after');
      return outcome();
    }
  };

  const result = await createBotPipelineRunner([
    middleware('first'),
    middleware('second')
  ]).execute({
    handler,
    update: preparedText(),
    jobId: '00000000-0000-4000-8000-000000000001',
    attempt: 2
  });

  assert.deepEqual(result, outcome());
  assert.deepEqual(events, [
    'first:execute:before',
    'second:execute:before',
    'handler:before',
    'first:conversation.generate:before',
    'second:conversation.generate:before',
    'operation',
    'second:conversation.generate:after',
    'first:conversation.generate:after',
    'handler:after',
    'second:execute:after',
    'first:execute:after'
  ]);
});

test('pipeline exposes immutable execution metadata and mutable scoped state', async () => {
  const update = preparedText();
  const handler: BotHandler<'message.text'> = {
    route: 'message.text',
    version: 3,
    async execute(_update, pipeline) {
      assert.ok(pipeline);
      assert.equal(pipeline.update, update);
      assert.equal(pipeline.handlerVersion, 3);
      assert.equal(pipeline.jobId, '00000000-0000-4000-8000-000000000002');
      assert.equal(pipeline.attempt, 4);
      assert.equal(Object.isFrozen(pipeline), true);
      pipeline.state.set('value', 42);
      assert.equal(pipeline.state.get('value'), 42);
      return outcome();
    }
  };

  await createBotPipelineRunner().execute({
    handler,
    update,
    jobId: '00000000-0000-4000-8000-000000000002',
    attempt: 4
  });
});

test('pipeline rejects missing and duplicate middleware names', () => {
  assert.throws(
    () => createBotPipelineRunner([{ name: '' }]),
    /pipeline_middleware_name_missing/
  );
  assert.throws(
    () => createBotPipelineRunner([{ name: 'trace' }, { name: 'trace' }]),
    /pipeline_middleware_duplicate:trace/
  );
});

test('pipeline rejects duplicate execute next calls', async () => {
  const handler: BotHandler<'message.text'> = {
    route: 'message.text',
    version: 1,
    async execute() { return outcome(); }
  };
  const runner = createBotPipelineRunner([{
    name: 'invalid',
    async execute(_context, next) {
      await next();
      return next();
    }
  }]);

  await assert.rejects(
    () => runner.execute({
      handler,
      update: preparedText(),
      jobId: '00000000-0000-4000-8000-000000000003',
      attempt: 1
    }),
    /pipeline_next_called_multiple_times/
  );
});

test('pipeline rejects duplicate stage next calls and preserves error cleanup', async () => {
  const events: string[] = [];
  const runner = createBotPipelineRunner([{
    name: 'invalid-stage',
    async aroundStage(_context, _stage, next) {
      try {
        await next();
        return await next();
      } finally {
        events.push('cleanup');
      }
    }
  }]);
  const handler: BotHandler<'message.text'> = {
    route: 'message.text',
    version: 1,
    async execute(_update, pipeline) {
      await pipeline?.runStage('conversation.generate', async () => undefined);
      return outcome();
    }
  };

  await assert.rejects(
    () => runner.execute({
      handler,
      update: preparedText(),
      jobId: '00000000-0000-4000-8000-000000000004',
      attempt: 1
    }),
    /pipeline_stage_next_called_multiple_times/
  );
  assert.deepEqual(events, ['cleanup']);
});

test('direct handler stage execution remains a no-op path', async () => {
  let called = 0;
  const result = await runBotPipelineStage(undefined, 'conversation.generate', async () => {
    called += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(called, 1);
});
