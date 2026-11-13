import { judgeCase } from '../scripts/evaluate-conversation-models.js';
import { structuredResponseFetch } from './fixtures/openai-http.js';
import { renderLlmPrompt } from '../src/ai/prompts/index.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile,
  validateConversationEvalFixture,
  validateConversationEvalResult,
  type ConversationEvalFixture
} from '../src/ai/model-eval.js';

const fixture = JSON.parse(fs.readFileSync(
  path.resolve(import.meta.dirname, '../evals/conversation-balanced-v1.json'),
  'utf8'
)) as ConversationEvalFixture;

test('balanced conversation fixture covers production languages and risk dimensions', () => {
  assert.deepEqual(validateConversationEvalFixture(fixture), []);
});

test('conversation eval hard checks distinguish valid routes', () => {
  const targetCase = fixture.cases.find((item) => item.id === 'de-es-b1-correct-target');
  assert.ok(targetCase);
  assert.deepEqual(validateConversationEvalResult(targetCase, {
    detected_language: 'es',
    is_target_language: true,
    has_mistakes: false,
    reply_text: 'Parece una buena idea. ¿Qué tipo de sopa preparaste?',
    explanation_html: ''
  }), []);

  const mixedCase = fixture.cases.find((item) => item.id === 'uk-de-a2-mixed-language');
  assert.ok(mixedCase);
  assert.deepEqual(validateConversationEvalResult(mixedCase, {
    detected_language: 'mixed',
    is_target_language: true,
    has_mistakes: true,
    reply_text: 'Das passt gut zu einem Kaffee.',
    explanation_html: '<b>Підказка</b>\n<blockquote>Ти можеш сказати це наступним чином: <code>Ich möchte einen Kaffee, aber ohne Zucker.</code></blockquote>'
  }), []);

  const invalid = validateConversationEvalResult(targetCase, {
    detected_language: 'es',
    is_target_language: false,
    has_mistakes: true,
    reply_text: '<b>bad</b>',
    explanation_html: '<script>bad</script>'
  });
  assert.ok(invalid.length >= 4);
});

test('percentile uses nearest-rank selection', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
});

test('evaluation judge keeps strict schema, blind labels, prompt and usage cost through LangChain', async (t) => {
  const requests: Array<Record<string, any>> = [];
  const judgment = { case_id: fixture.cases[0].id, assessments: [], comparisons: [] };
  t.mock.method(globalThis, 'fetch', structuredResponseFetch(async body => {
    requests.push(body);
    return { output_text: JSON.stringify(judgment), usage: {
      input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 10, total_tokens: 110
    } };
  }));
  const result = await judgeCase('test-key', fixture.cases[0], [], 0);
  assert.deepEqual(result.result, judgment);
  assert.deepEqual(Object.values(result.labelToVariant), ['luna_none', 'luna_low', 'baseline']);
  assert.equal(result.estimatedCostUsd, (80 * 2.5 + 20 * 0.25 + 10 * 15) / 1_000_000);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(request.text.format.name, 'conversation_model_eval_judgment');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[0].content, renderLlmPrompt('evaluation/judge-system'));
  assert.match(request.input[1].content, /comparisons_requested/);
  assert.doesNotMatch(request.input[1].content, /luna_none|luna_low|baseline|gpt-/);
});
