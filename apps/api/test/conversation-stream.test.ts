import test from 'node:test';
import assert from 'node:assert/strict';
import { partialConversationReply } from '../src/bot-runtime/conversation-stream.js';
import { createTelegramDraft } from '../src/bot-runtime/telegram-draft.js';
import { createBotAiClient } from '../src/bot-runtime/bot-ai.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

test('partial structured output exposes only the reply, safely across every chunk boundary', () => {
  const reply = 'Hi "Alice"!\nC:\\home 😀 Привіт';
  const source = JSON.stringify({
    detected_language: 'en', is_target_language: true, has_mistakes: false,
    reply_text: reply, explanation_html: 'Never show this'
  });
  for (let length = 0; length <= source.length; length++) {
    const preview = partialConversationReply(source.slice(0, length));
    assert.ok(reply.startsWith(preview), JSON.stringify(preview));
    assert.ok(!/[\uD800-\uDBFF]$/u.test(preview));
  }
  assert.equal(partialConversationReply(source), reply);
  assert.equal(partialConversationReply(source.replace('true', 'false')), '');
  assert.equal(partialConversationReply('{"explanation_html":"\\\"reply_text\\\": \\"fake\\""'), '');
  assert.equal(partialConversationReply('{"is_target_language":true,"reply_text":"Hi \\uD83D\\uDE'), 'Hi ');
});

function streamingClient(events: object[], previews: string[], requests: object[]) {
  return createBotAiClient({
    apiKey: 'test-key', model: 'test-model', supportModel: 'test-model',
    getBotConfig: () => ({ bot_key: 'uk-en', learning_language: 'en', base_language: 'uk' }),
    createClient: () => ({ responses: { async create(request: object) {
      requests.push(request);
      return (async function* () { for (const event of events) yield event; })();
    } } }) as never
  }).respond({
    botKey: 'uk-en', level: 'a1', inputMode: 'text', text: 'Hello',
    profileSummary: '', shortSummary: '', history: [], topic: null,
    onReplyText: (text) => { previews.push(text); }
  });
}

test('AI streaming returns the validated final result and produces incremental reply previews', async () => {
  const value = { detected_language: 'en', is_target_language: true, has_mistakes: false,
    reply_text: 'Hello there!', explanation_html: '' };
  const source = JSON.stringify(value);
  const previews: string[] = [];
  const requests: Array<{ stream?: boolean }> = [];
  const result = await streamingClient([
    ...[...source].map((delta) => ({ type: 'response.output_text.delta', delta })),
    { type: 'response.completed', response: { output_text: source, usage: { input_tokens: 10, output_tokens: 20 } } }
  ], previews, requests);
  assert.equal(requests[0].stream, true);
  assert.equal(result.reply_text, value.reply_text);
  assert.ok(previews.length > 2);
  assert.equal(previews.at(-1), value.reply_text);
});

for (const terminal of ['none', 'response.failed', 'response.incomplete', 'error']) {
  test(`AI stream ${terminal} cannot be committed as a completed reply`, async () => {
    const previews: string[] = [];
    const events: object[] = [{ type: 'response.output_text.delta', delta: '{"is_target_language":true,"reply_text":"Hi' }];
    if (terminal !== 'none') events.push({ type: terminal });
    await assert.rejects(streamingClient(events, previews, []), /openai_stream_/);
  });
}

const update = buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ text: 'Hi' })) });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('draft coalesces updates, uses a stable nonzero ID, and stops before final delivery', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let finishFirst!: () => void;
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const first = new Promise<void>((resolve) => { firstStarted = resolve; });
  const second = new Promise<void>((resolve) => { secondStarted = resolve; });
  const pending = new Promise<void>((resolve) => { finishFirst = resolve; });
  const draft = createTelegramDraft({ async callTelegramApi(_bot, method, body) {
    assert.equal(method, 'sendMessageDraft'); calls.push(body);
    if (calls.length === 1) { firstStarted(); await pending; }
    else secondStarted();
    return true;
  } }, update, { intervalMs: 0, timeoutMs: 1000 });
  draft.update('H');
  await first;
  draft.update('Hello'); draft.update('Hello there');
  assert.equal(calls.length, 1);
  finishFirst();
  await second;
  await draft.stop();
  draft.update('must not send');
  await Promise.resolve();
  assert.deepEqual(calls.map((call) => call.text), ['H', 'Hello there']);
  assert.equal(calls[0].draft_id, calls[1].draft_id);
  assert.ok(Number(calls[0].draft_id) > 0);
});

test('a stuck or rate-limited draft never fails the final reply path', async () => {
  for (const hangs of [true, false]) {
    let count = 0;
    let signal: AbortSignal | undefined;
    const draft = createTelegramDraft({ callTelegramApi(_bot, _method, _body, options) {
      count++; signal = options?.signal;
      return hangs ? new Promise(() => {}) : Promise.reject(Object.assign(new Error('Too Many Requests'), { telegramStatus: 429 }));
    } }, update, { intervalMs: 1, timeoutMs: 5 });
    draft.update('Hello');
    await delay(15);
    draft.update('Hello there');
    await draft.stop();
    assert.equal(count, 1);
    if (hangs) assert.equal(signal?.aborted, true);
  }
});
