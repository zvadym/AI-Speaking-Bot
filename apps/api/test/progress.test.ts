import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import { parseProgressEnabledBotKeys } from '../src/bot-runtime/middleware/progress-config.js';
import { createConversationProgress } from '../src/bot-runtime/middleware/progress.js';
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

function harness(options: { startError?: Error; stopError?: Error; sessionId?: string } = {}) {
  const events: string[] = [];
  const errors: Array<{ event: string; error: unknown }> = [];
  const service = {
    async start() {
      events.push('progress:start');
      if (options.startError) throw options.startError;
      return { sessionId: options.sessionId ?? 'session-1', messageId: 44 };
    },
    async stop(input: { sessionId?: string | null }) {
      events.push(`progress:stop:${input.sessionId}`);
      if (options.stopError) throw options.stopError;
      return true;
    },
    async rotate() { return true; },
    async timeout() { return true; }
  } as ProgressService;
  const withProgress = createConversationProgress({
    progressService: service,
    getBotLocale: () => ({
      waiting_text: 'Waiting',
      loader_messages: ['Still working']
    }),
    enabledBotKeys: new Set(['uk-de']),
    reportError(error, event) { errors.push({ event, error }); }
  });
  return { events, errors, withProgress };
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

for (const route of ['message.text', 'message.voice'] as const) {
  test(`${route} progress surrounds generation and preserves its result`, async () => {
    const h = harness();
    const result = { status: 'noop' };
    assert.equal(await h.withProgress(update(route), async () => {
      h.events.push('operation');
      return result;
    }), result);
    assert.deepEqual(h.events, ['progress:start', 'operation', 'progress:stop:session-1']);
  });
}

for (const stopError of [undefined, new Error('stop unavailable')]) {
  test(`generation failure preserves error identity after cleanup${stopError ? ' failure' : ''}`, async () => {
    const h = harness({ stopError });
    const failure = new Error('generation failed');
    await assert.rejects(h.withProgress(update(), async () => {
      h.events.push('operation');
      throw failure;
    }), (error) => error === failure);
    assert.deepEqual(h.events, ['progress:start', 'operation', 'progress:stop:session-1']);
    assert.deepEqual(h.errors, stopError ? [{ event: 'stop', error: stopError }] : []);
  });
}

test('progress start and stop failures are reported without blocking generation', async () => {
  for (const event of ['start', 'stop'] as const) {
    const failure = new Error(`${event} unavailable`);
    const h = harness(event === 'start' ? { startError: failure } : { stopError: failure });
    const result = { status: 'noop' };
    assert.equal(await h.withProgress(update(), async () => {
      h.events.push('operation');
      return result;
    }), result);
    assert.deepEqual(h.events, event === 'start'
      ? ['progress:start', 'operation']
      : ['progress:start', 'operation', 'progress:stop:session-1']);
    assert.deepEqual(h.errors, [{ event, error: failure }]);
  }
});

test('progress ignores commands, disabled bots and invalid private chat IDs', async () => {
  const command = update('command.unknown');
  const disabled = update();
  disabled.botKey = 'uk-en';
  const inputs = [command, disabled, ...[null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN].map((chatId) => {
    const input = update();
    input.input.chatId = chatId;
    return input;
  })];
  for (const input of inputs) {
    const h = harness();
    await h.withProgress(input, async () => { h.events.push('operation'); });
    assert.deepEqual(h.events, ['operation']);
    assert.deepEqual(h.errors, []);
  }
});

test('progress does not stop when start returns no session ID', async () => {
  const h = harness({ sessionId: '' });
  await h.withProgress(update(), async () => { h.events.push('operation'); });
  assert.deepEqual(h.events, ['progress:start', 'operation']);
});
