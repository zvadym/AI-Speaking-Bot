import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredResponseFetch } from './fixtures/openai-http.js';
import { translateIdiomPhraseEntry } from '../src/idiom-phrases.js';

test('idiom translation preserves structured output and the reasoning override', async () => {
  const requests = [];
  const events = [];
  const translated = {
    phrase_translation: 'Успіху!', meaning_translation: 'Побажання успіху',
    tone_translation: 'Неформально', example_translation: 'Успіху на виступі!'
  };
  const fetchImpl = structuredResponseFetch(async (body) => {
    requests.push(body);
    return { output: [{ content: [{ type: 'output_text', text: JSON.stringify(translated) }] }] };
  });
  const options = {
    fetchImpl, apiKey: 'test-key', model: 'gpt-6.1-terra', targetLanguage: 'en', baseLanguage: 'uk',
    entry: { phraseText: 'Break a leg!', meaningText: 'Good luck', toneText: 'Informal', exampleText: 'Break a leg tonight!' },
    recordLlmCall: async (event) => events.push(event)
  };
  assert.deepEqual(await translateIdiomPhraseEntry(options), { ...translated, source: 'llm' });
  await translateIdiomPhraseEntry({ ...options, reasoningEffort: 'none' });
  assert.deepEqual(requests.map((body) => body.reasoning.effort), ['low', 'none']);
  assert.ok(requests.every(body => body.text.verbosity === 'low' && body.text.format.strict === undefined));
  assert.deepEqual(events.map((event) => [event.model, event.reasoningEffort]), [
    ['gpt-6.1-terra', 'low'], ['gpt-6.1-terra', 'none']
  ]);
});

test('idiom translation preserves passthrough and field normalization fallbacks', async () => {
  const entry = { phraseText: 'Break a leg!', meaningText: 'Good luck', toneText: 'Informal', exampleText: 'Break a leg tonight!' };
  const options = { apiKey: 'test-key', model: 'gpt-5-mini', targetLanguage: 'en', baseLanguage: 'uk', entry };
  assert.deepEqual(await translateIdiomPhraseEntry({ ...options,
    fetchImpl: structuredResponseFetch(async () => ({ output_text: JSON.stringify({
      phrase_translation: '  Успіху!  \n', meaning_translation: '', tone_translation: null
    }) }))
  }), { phrase_translation: 'Успіху!', meaning_translation: entry.meaningText,
    tone_translation: entry.toneText, example_translation: entry.exampleText, source: 'llm' });
  assert.deepEqual(await translateIdiomPhraseEntry({ ...options, apiKey: '', baseLanguage: 'en',
    fetchImpl: async () => { throw new Error('passthrough must not call provider'); }
  }), { phrase_translation: entry.phraseText, meaning_translation: entry.meaningText,
    tone_translation: entry.toneText, example_translation: entry.exampleText, source: 'passthrough' });
});
