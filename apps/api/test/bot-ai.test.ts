import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotAiClient } from '../src/bot-runtime/bot-ai.js';

test('bot AI renders configured prompts and parses structured Responses output', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createBotAiClient({
    apiKey: 'test-key',
    model: 'test-model',
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
            }]
          };
        }
      }
    } as never)
  });

  assert.equal(await client.translate('uk-en', 'Hello'), 'Привіт');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'test-model');
  const input = calls[0].input as Array<{ content: string }>;
  assert.match(input[0].content, /Teacher/);
  assert.match(input[0].content, /Ukrainian/);
  assert.match(input[1].content, /Hello/);
});
