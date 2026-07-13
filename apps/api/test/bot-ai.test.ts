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
    supportReasoningEffort: 'none',
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
  assert.deepEqual(calls[0].reasoning, { effort: 'none' });
  const input = calls[0].input as Array<{ content: string }>;
  assert.match(input[0].content, /Teacher/);
  assert.match(input[0].content, /Ukrainian/);
  assert.match(input[1].content, /Hello/);
  assert.equal(telemetry.length, 1);
  assert.deepEqual({
    operation: telemetry[0].operation,
    model: telemetry[0].model,
    reasoningEffort: telemetry[0].reasoningEffort,
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
    reasoningEffort: 'none',
    decisionId: 'v1:uk-en:1',
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 10,
    reasoningTokens: 2,
    totalTokens: 110,
    success: true
  });
});

test('bot AI applies model policy only to the selected bot key', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createBotAiClient({
    apiKey: 'test-key',
    model: 'default-conversation',
    supportModel: 'default-support',
    getModelPolicy: (botKey) => botKey === 'uk-de'
      ? { supportModel: 'canary-support', supportReasoningEffort: 'low' }
      : undefined,
    getBotConfig: (botKey) => ({
      bot_key: botKey,
      base_language: botKey.split('-')[0],
      learning_language: botKey.split('-')[1]
    }),
    createClient: () => ({
      responses: {
        async create(input: Record<string, unknown>) {
          calls.push(input);
          return { output_text: JSON.stringify({ translation_base: 'ok' }) };
        }
      }
    } as never)
  });

  await client.translate('uk-en', 'Hello');
  await client.translate('uk-de', 'Hallo');
  assert.deepEqual(calls.map((call) => ({ model: call.model, reasoning: call.reasoning })), [
    { model: 'default-support', reasoning: undefined },
    { model: 'canary-support', reasoning: { effort: 'low' } }
  ]);
});

test('bot AI normalizes HTML breaks and constrains pinned third-language examples', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createBotAiClient({
    apiKey: 'test-key',
    model: 'test-model',
    getBotConfig: () => ({
      bot_key: 'uk-es',
      bot_name: 'Teacher',
      base_language: 'uk',
      learning_language: 'es'
    }),
    createClient: () => ({
      responses: {
        async create(input: Record<string, unknown>) {
          calls.push(input);
          return {
            output_text: JSON.stringify({
              detected_language: 'en',
              is_target_language: false,
              has_mistakes: false,
              reply_text: '',
              explanation_html: '<b>Спробуй іспанською</b><BR /><blockquote><code>Quiero planear la ruta.</code></blockquote>'
            })
          };
        }
      }
    } as never)
  });

  const result = await client.respond({
    botKey: 'uk-es',
    level: 'B2',
    inputMode: 'text',
    text: 'I would rather discuss a different subject today.',
    profileSummary: '',
    shortSummary: '',
    history: [],
    topic: {
      topic_id: 'travel-planning',
      title_base: 'Планування подорожі',
      goal_base: 'Підготувати практичний план подорожі',
      allowed_base: ['транспорт', 'житло', 'маршрут']
    }
  });

  assert.equal(
    result.explanation_html,
    '<b>Спробуй іспанською</b>\n<blockquote><code>Quiero planear la ruta.</code></blockquote>'
  );
  const input = calls[0].input as Array<{ content: string }>;
  assert.match(input[0].content, /NEVER translate or paraphrase a request to change, leave, or replace the topic/);
  assert.match(input[1].content, /PINNED TOPIC \(base language\): Планування подорожі/);
  assert.match(input[1].content, /ALLOWED SUB-AREAS: транспорт; житло; маршрут/);
});

test('bot AI renders Hindi hint labels in the learner base language', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createBotAiClient({
    apiKey: 'test-key',
    model: 'test-model',
    getBotConfig: () => ({
      bot_key: 'hi-en',
      bot_name: 'Teacher',
      base_language: 'hi',
      learning_language: 'en'
    }),
    createClient: () => ({
      responses: {
        async create(input: Record<string, unknown>) {
          calls.push(input);
          return {
            output_text: JSON.stringify({
              detected_language: 'hi',
              is_target_language: true,
              has_mistakes: true,
              reply_text: 'What kind of work will you be doing?',
              explanation_html: '<b>संकेत</b><blockquote>आप इसे इस तरह कह सकते हैं: <code>I am starting a new job next month.</code></blockquote>'
            })
          };
        }
      }
    } as never)
  });

  await client.respond({
    botKey: 'hi-en',
    level: 'B1',
    inputMode: 'text',
    text: 'मैं अगले महीने नई नौकरी शुरू करने वाला हूँ।',
    profileSummary: '',
    shortSummary: '',
    history: [],
    topic: null
  });

  const input = calls[0].input as Array<{ content: string }>;
  assert.match(input[0].content, /<b>संकेत<\/b>/);
  assert.match(input[0].content, /आप इसे इस तरह कह सकते हैं:/);
  assert.match(input[0].content, /explanation_html must be in Hindi/);
  assert.match(input[0].content, /Preserve the learner's intended meaning, referents, gender, number, names, and factual claims/);
});
