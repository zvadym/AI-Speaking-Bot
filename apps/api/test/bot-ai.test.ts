import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotAiClient } from '../src/bot-runtime/bot-ai.js';
import type { LlmCallEvent } from '../src/bot-runtime/llm-telemetry.js';

test('bot AI renders configured prompts and parses structured Responses output', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const telemetry: LlmCallEvent[] = [];
  const client = createBotAiClient({
    apiKey: 'test-key',
    model: 'test-model',
    supportModel: 'test-support-model',
    recordLlmCall: async (event) => { telemetry.push(event); },
    getBotConfig: () => ({
      bot_key: 'uk-en',
      bot_name: 'Teacher',
      base_language: 'uk',
      learning_language: 'en'
    }),
    createClient: () => ({
      responses: {
        async create(input: Record<string, unknown>) {
          calls.push(input);
          return {
            output: [{
              type: 'message',
              content: [{
                type: 'output_text',
                text: JSON.stringify({ translation_base: 'Привіт' })
              }]
            }],
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 20 },
              output_tokens: 10,
              output_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 110
            }
          };
        }
      }
    } as never)
  });

  assert.equal(await client.translate('uk-en', 'Hello', {
    decisionId: 'v1:uk-en:1',
    chatId: 1,
    botKey: 'uk-en',
    route: 'callback.translate'
  }), 'Привіт');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'test-support-model');
  const input = calls[0].input as Array<{ content: string }>;
  assert.match(input[0].content, /Teacher/);
  assert.match(input[0].content, /Ukrainian/);
  assert.match(input[1].content, /Hello/);
  assert.equal(telemetry.length, 1);
  assert.deepEqual({
    operation: telemetry[0].operation,
    model: telemetry[0].model,
    decisionId: telemetry[0].trace.decisionId,
    inputTokens: telemetry[0].inputTokens,
    cachedInputTokens: telemetry[0].cachedInputTokens,
    outputTokens: telemetry[0].outputTokens,
    reasoningTokens: telemetry[0].reasoningTokens,
    totalTokens: telemetry[0].totalTokens,
    success: telemetry[0].success
  }, {
    operation: 'support.translate',
    model: 'test-support-model',
    decisionId: 'v1:uk-en:1',
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 10,
    reasoningTokens: 2,
    totalTokens: 110,
    success: true
  });
});
