import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBotModelPolicyOverrides,
  parseModelReasoningEffort,
  resolveBotModelPolicy
} from '../src/bot-runtime/model-policy.js';

test('model policy is dark by default and parses a scoped canary', () => {
  assert.deepEqual(parseBotModelPolicyOverrides('', ['uk-de']), {});
  assert.deepEqual(parseBotModelPolicyOverrides(JSON.stringify({
    'uk-de': {
      conversationModel: 'gpt-5.6-luna',
      conversationReasoningEffort: 'none'
    }
  }), ['uk-de', 'uk-en']), {
    'uk-de': {
      conversationModel: 'gpt-5.6-luna',
      conversationReasoningEffort: 'none'
    }
  });
});

test('model policy rejects unknown bots, fields, and reasoning effort', () => {
  assert.throws(
    () => parseBotModelPolicyOverrides('{"missing":{"conversationModel":"gpt"}}', ['uk-de']),
    /unknown bot key/
  );
  assert.throws(
    () => parseBotModelPolicyOverrides('{"uk-de":{"fallbackModel":"gpt"}}', ['uk-de']),
    /unknown field/
  );
  assert.throws(
    () => parseBotModelPolicyOverrides('{"uk-de":{"conversationReasoningEffort":"auto"}}', ['uk-de']),
    /Invalid reasoning effort/
  );
  assert.throws(() => parseModelReasoningEffort('auto', 'test'), /Invalid reasoning effort/);
});

test('model policy resolves explicit overrides over global defaults', () => {
  assert.deepEqual(resolveBotModelPolicy({
    conversationModel: 'gpt-5.4',
    supportModel: 'gpt-5.4-mini',
    supportReasoningEffort: 'none'
  }, {
    conversationModel: 'gpt-5.6-luna',
    conversationReasoningEffort: 'low'
  }), {
    conversationModel: 'gpt-5.6-luna',
    conversationReasoningEffort: 'low',
    supportModel: 'gpt-5.4-mini',
    supportReasoningEffort: 'none'
  });
});
