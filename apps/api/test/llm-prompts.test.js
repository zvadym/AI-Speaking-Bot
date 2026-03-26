import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLlmPrompt } from '../src/llm-prompts/index.js';

test('renderLlmPrompt injects shared user-facing tone rules automatically', () => {
  const rendered = renderLlmPrompt('winback-system', {
    base_language_label: 'English',
    target_language_label: 'German',
    reminder_goal: 'Invite the user back for one short rep.',
    message_max_len: 220,
    message_max_sentences: 2
  });

  assert.match(rendered, /User-facing tone rules:/);
  assert.doesNotMatch(rendered, /\{\{\s*user_facing_tone_rules\s*\}\}/);
});
