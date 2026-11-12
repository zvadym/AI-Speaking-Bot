import test from 'node:test';
import assert from 'node:assert/strict';
import { Responses } from 'openai/resources/responses/responses';
import { translateIdiomPhraseEntry } from '../src/idiom-phrases.js';

test('idiom translation preserves structured output and the reasoning override', async (t) => {
  const requests = [];
  const events = [];
  const translated = {
    phrase_translation: 'Успіху!', meaning_translation: 'Побажання успіху',
    tone_translation: 'Неформально', example_translation: 'Успіху на виступі!'
  };
  t.mock.method(Responses.prototype, 'create', async (body) => {
    requests.push(body);
    return { output: [{ content: [{ type: 'output_text', text: JSON.stringify(translated) }] }] };
  });
  const options = {
    apiKey: 'test-key', model: 'gpt-6.1-terra', targetLanguage: 'en', baseLanguage: 'uk',
    entry: { phraseText: 'Break a leg!', meaningText: 'Good luck', toneText: 'Informal', exampleText: 'Break a leg tonight!' },
    recordLlmCall: async (event) => events.push(event)
  };
  assert.deepEqual(await translateIdiomPhraseEntry(options), { ...translated, source: 'llm' });
  await translateIdiomPhraseEntry({ ...options, reasoningEffort: 'none' });
  assert.deepEqual(requests.map((body) => body.reasoning.effort), ['low', 'none']);
  assert.deepEqual(events.map((event) => [event.model, event.reasoningEffort]), [
    ['gpt-6.1-terra', 'low'], ['gpt-6.1-terra', 'none']
  ]);
});
