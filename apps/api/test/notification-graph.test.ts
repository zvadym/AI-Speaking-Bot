import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationGraph } from '../src/ai/graphs/notifications.js';

test('notification accepts normalized AI text and preserves model metadata without fallback', async () => {
  const graph = createNotificationGraph({
    async generate(context: { name: string }, taskType) {
      assert.equal(taskType, 'weekly_digest');
      return { messageText: `  Hello ${context.name}  `, source: 'llm', responseId: 'resp_1', usage: { total_tokens: 12 } };
    },
    validate(text) { return { ok: true, messageText: text.trim() }; },
    fallback() { throw new Error('valid AI must not fall back'); }
  });
  const result = await graph.invoke({ usesLlm: true }, { context: { notification: { name: 'Nina' }, taskType: 'weekly_digest' } });
  assert.deepEqual(result.generation, { messageText: 'Hello Nina', source: 'llm', responseId: 'resp_1', usage: { total_tokens: 12 } });
});

for (const cause of ['invalid_output', 'provider_error', 'template_only'] as const) {
  test(`notification ${cause} validates one fallback without retries and isolates invocation context`, async () => {
    let generated = 0;
    let fallbackCalls = 0;
    const graph = createNotificationGraph({
      async generate(context: { name: string }) {
        generated++;
        if (cause === 'provider_error') throw Object.assign(new Error('Provider sk-private123 Bearer secret https://host/path'), { request: { secret: 'must never enter state' } });
        return { messageText: `invalid ${context.name}`, source: 'llm' };
      },
      validate(text) { return text.startsWith('invalid') ? { ok: false, error: 'invalid_message' } : { ok: true, messageText: text.trim() }; },
      fallback(context) { fallbackCalls++; return { ok: true, messageText: `  Hello ${context.name}  `, source: 'fallback_template', variantIndex: 2 }; }
    });
    const results = await Promise.all(['Nina', 'Mira'].map(name => graph.invoke({ usesLlm: cause !== 'template_only' },
      { context: { notification: { name }, taskType: 'winback_d3' } })));
    assert.equal(generated, cause === 'template_only' ? 0 : 2);
    assert.equal(fallbackCalls, 2);
    assert.deepEqual(results.map(result => result.generation?.messageText), ['Hello Nina', 'Hello Mira']);
    assert.ok(results.every(result => result.generation?.variantIndex === 2));
    if (cause === 'provider_error') {
      assert.ok(results.every(result => typeof result.generationError === 'string'));
      assert.doesNotMatch(JSON.stringify(results), /private123|Bearer secret|host\/path|must never enter/);
    }
  });
}

test('invalid fallback terminates once with separate generation and validation diagnostics', async () => {
  let fallbackCalls = 0;
  const graph = createNotificationGraph({
    async generate() { throw new Error('provider_unavailable'); },
    validate() { return { ok: false, error: 'invalid_fallback' }; },
    fallback() { fallbackCalls++; return { ok: true, messageText: 'invalid', source: 'fallback_template' }; }
  });
  const result = await graph.invoke({ usesLlm: true }, { context: { notification: {}, taskType: 'winback_d3' } });
  assert.equal(fallbackCalls, 1);
  assert.equal(result.generation, null);
  assert.equal(result.generationError, 'provider_unavailable');
  assert.equal(result.fallbackError, 'invalid_fallback');
  assert.equal(result.failure, 'validation');
});
