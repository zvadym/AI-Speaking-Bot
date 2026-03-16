import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFallbackSubareas,
  inferSubareaId,
  normalizeStoredSubareas,
  normalizeTopicSubareas
} from '../src/topic-subareas.js';

test('normalizeTopicSubareas requires a 1:1 match with allowed_base', () => {
  assert.throws(
    () => normalizeTopicSubareas([
      { id: 'one', label_base: 'One', keywords_target: ['first'], keywords_base: [] }
    ], { allowedBase: ['One', 'Two'] }),
    /same number of items as allowed_base/
  );
});

test('normalizeStoredSubareas drops invalid stored payloads instead of crashing', () => {
  assert.deepEqual(
    normalizeStoredSubareas('[{"id":"one","label_base":"","keywords_target":[]}]', { allowedBase: ['One'] }),
    []
  );
});

test('inferSubareaId prefers target-language keyword hits and returns stable ids', () => {
  const subareas = normalizeTopicSubareas([
    {
      id: 'furniture',
      label_base: 'Меблі',
      keywords_target: ['furniture', 'sofa', 'wardrobe'],
      keywords_base: ['меблі']
    },
    {
      id: 'rooms',
      label_base: 'Кімнати',
      keywords_target: ['bedroom', 'kitchen'],
      keywords_base: ['кімнати']
    }
  ], { allowedBase: ['Меблі', 'Кімнати'] });

  assert.equal(
    inferSubareaId('What furniture do you want in the apartment?', subareas),
    'furniture'
  );
});

test('inferSubareaId falls back to legacy allowed_base matching for pseudo-subareas', () => {
  const fallback = buildFallbackSubareas(['меблі', 'кімнати']);
  assert.equal(
    inferSubareaId('Які меблі тобі потрібні?', fallback, { legacyAllowedBase: ['меблі', 'кімнати'] }),
    fallback[0].id
  );
});
