import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderBotPrompt } from '../src/ai/prompts/bot-prompts.js';

import { renderLlmPrompt } from '../src/ai/prompts/index.js';

test('renderLlmPrompt injects shared user-facing tone rules automatically', () => {
  const rendered = renderLlmPrompt('notifications/winback-system', {
    base_language_label: 'English',
    target_language_label: 'German',
    reminder_goal: 'Invite the user back for one short rep.',
    message_max_len: 220,
    message_max_sentences: 2
  });

  assert.match(rendered, /User-facing tone rules:/);
  assert.doesNotMatch(rendered, /\{\{\s*user_facing_tone_rules\s*\}\}/);
});

test('grouped prompt override preserves bot and general rendering semantics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-prompt-resources-'));
  const previous = process.env.BOT_RUNTIME_PROMPTS_DIR;
  try {
    for (const group of ['conversation', 'notifications', 'idioms', 'shared']) {
      await mkdir(path.join(root, group));
    }
    await writeFile(path.join(root, 'shared/user-facing-tone.md'), '  shared\r\ntone  ');
    await writeFile(path.join(root, 'conversation/model_system_prompt.md'),
      '  {{bot_key}}|{{bot_name}}|{{unknown}}|{{123}}|{{user_facing_tone_rules}}|{{bot_key}}\r\n');
    await writeFile(path.join(root, 'notifications/winback-system.md'),
      '  {{value}}|{{unknown}}|{{123}}|{{user_facing_tone_rules}}|{{value}}\r\n');
    await writeFile(path.join(root, 'idioms/idiom-translation-system.md'), '{{user_facing_tone_rules}}');
    process.env.BOT_RUNTIME_PROMPTS_DIR = root;

    assert.equal(renderBotPrompt('conversation/model_system_prompt', ' uk-en ', { bot_name: ' Teacher ' }),
      ' uk-en |Teacher||{{123}}|shared\ntone| uk-en ');
    assert.equal(renderLlmPrompt('notifications/winback-system', { value: ' x ', 123: 0 }),
      'x ||0|shared\ntone| x');
    assert.equal(renderLlmPrompt('idioms/idiom-translation-system'), 'shared\ntone');
  } finally {
    if (previous === undefined) delete process.env.BOT_RUNTIME_PROMPTS_DIR;
    else process.env.BOT_RUNTIME_PROMPTS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
