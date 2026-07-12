import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile,
  validateConversationEvalFixture,
  validateConversationEvalResult,
  type ConversationEvalFixture
} from '../src/bot-runtime/model-eval.js';

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
