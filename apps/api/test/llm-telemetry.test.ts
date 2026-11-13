import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  classifyLlmError,
  createLlmCallRecorder,
  extractLlmUsage,
  observeLlmCall,
  type LlmCallEvent
} from '../src/ai/llm-telemetry.js';

test('LLM usage extraction supports Responses token details', () => {
  assert.deepEqual(extractLlmUsage({
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 150
    }
  }), {
    inputTokens: 120,
    cachedInputTokens: 80,
    outputTokens: 30,
    reasoningTokens: 5,
    totalTokens: 150
  });
  assert.deepEqual(extractLlmUsage({}), {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null
  });
});

test('LLM observer records bounded success metadata and returns the original result', async () => {
  const events: LlmCallEvent[] = [];
  const clock = [10, 24];
  const response = { usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
  const result = await observeLlmCall({
    trace: {
      decisionId: 'v1:uk-de:1',
      chatId: 1,
      botKey: 'uk-de',
      route: 'message.text'
    },
    operation: 'conversation.respond',
    model: 'gpt-test',
    record: async (event) => { events.push(event); },
    call: async () => response,
    now: () => clock.shift() || 0
  });

  assert.equal(result, response);
  assert.equal(events.length, 1);
  assert.equal(events[0].durationMs, 14);
  assert.equal(events[0].success, true);
  assert.equal(events[0].inputTokens, 5);
  assert.equal(events[0].outputTokens, 2);
});

test('LLM observer preserves call failures even when telemetry recorder fails', async () => {
  const failure = Object.assign(new Error('rate limited'), { status: 429 });
  await assert.rejects(
    () => observeLlmCall({
      trace: { botKey: 'uk-de' },
      operation: 'conversation.respond',
      model: 'gpt-test',
      record: async () => { throw new Error('database unavailable'); },
      call: async () => { throw failure; }
    }),
    failure
  );
  assert.equal(classifyLlmError(failure), '429');
});

test('LLM recorder persists metadata fields without prompt or response content', async () => {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const pool = {
    async query(text: string, params: unknown[]) {
      queries.push({ text, params });
      return { rows: [], rowCount: 1 };
    }
  } as unknown as Pool;
  const record = createLlmCallRecorder(pool);
  await record({
    trace: {
      decisionId: 'v1:uk-de:1',
      chatId: 1,
      botKey: 'uk-de',
      route: 'message.text'
    },
    operation: 'conversation.respond',
    model: 'gpt-test',
    reasoningEffort: null,
    durationMs: 12,
    success: true,
    errorCode: null,
    inputTokens: 5,
    cachedInputTokens: 1,
    outputTokens: 2,
    reasoningTokens: 0,
    totalTokens: 7
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO llm_call_events/u);
  assert.equal(queries[0].params.length, 15);
  assert.doesNotMatch(JSON.stringify(queries[0]), /prompt|transcript|response content/iu);
});

test('LLM recorder swallows database telemetry failures', async () => {
  const pool = {
    async query() { throw new Error('database unavailable'); }
  } as unknown as Pool;
  await assert.doesNotReject(() => createLlmCallRecorder(pool)({
    trace: { botKey: 'uk-de' },
    operation: 'conversation.respond',
    model: 'gpt-test',
    reasoningEffort: null,
    durationMs: 1,
    success: false,
    errorCode: 'failed',
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null
  }));
});
