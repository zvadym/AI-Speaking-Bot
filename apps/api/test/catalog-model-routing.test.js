import test from 'node:test';
import assert from 'node:assert/strict';
import { Responses } from 'openai/resources/responses/responses';
import { generateTopicDraft, assistTopicDraft, cloneTopicDraftToBot } from '../src/topic-generator.js';
import { translateIdiomPhraseEntry } from '../src/idiom-phrases.js';

const draft = {
  topic_id: 'coffee', emoji: '☕', access_tier: 'all',
  title_base: 'Coffee shop', goal_base: 'Order a coffee',
  allowed_base: ['ordering', 'paying'], avoid_base: ['politics', 'medicine'],
  starter_questions_target: ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?', 'Q6?'],
  recovery_questions_target: ['R1?', 'R2?', 'R3?', 'R4?', 'R5?', 'R6?']
};

test('all topic operations pass explicit model/reasoning to Responses and telemetry', async (t) => {
  const requests = [];
  const events = [];
  t.mock.method(Responses.prototype, 'create', async (body) => {
    requests.push(body);
    return { output_text: JSON.stringify(draft) };
  });
  const options = {
    apiKey: 'test-key', model: 'gpt-6.1-terra',
    baseLanguage: 'en', targetLanguage: 'de',
    recordLlmCall: async (event) => events.push(event)
  };
  await generateTopicDraft({ ...options, topicName: 'Coffee shop' });
  await assistTopicDraft({ ...options, instruction: 'Make it easier', currentDraft: draft });
  await cloneTopicDraftToBot({
    ...options, sourceBaseLanguage: 'en', sourceTargetLanguage: 'de',
    targetBaseLanguage: 'uk', targetTargetLanguage: 'en', currentDraft: draft,
    reasoningEffort: 'medium'
  });
  assert.deepEqual(events.map((event) => [event.operation, event.reasoningEffort]), [
    ['topic.generate', 'low'], ['topic.assist', 'low'], ['topic.clone', 'medium']
  ]);
  assert.deepEqual(requests.map((body) => [body.model, body.reasoning.effort]), [
    ['gpt-6.1-terra', 'low'], ['gpt-6.1-terra', 'low'], ['gpt-6.1-terra', 'medium']
  ]);
  assert.ok(requests.every((body) => body.text.format.type === 'json_schema'));
  assert.ok(requests.every((body) => body.text.format.strict === false));
});

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
