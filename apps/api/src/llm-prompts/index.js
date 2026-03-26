import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const promptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(promptsDir, '../../../..');
const sharedPartialsDir = path.join(repoRoot, 'shared', 'llm-prompts');
const promptCache = new Map();
const sharedVariableCache = new Map();
const sharedVariableFiles = {
  user_facing_tone_rules: 'user-facing-tone.md'
};

function loadPromptTemplate(name) {
  const key = String(name || '').trim();
  if (!key) {
    throw new Error('Prompt template name is required');
  }
  if (promptCache.has(key)) {
    return promptCache.get(key);
  }

  const filename = path.join(promptsDir, `${key}.md`);
  const template = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  promptCache.set(key, template);
  return template;
}

function loadSharedVariable(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  if (sharedVariableCache.has(key)) {
    return sharedVariableCache.get(key);
  }

  const relativeName = sharedVariableFiles[key];
  if (!relativeName) return '';
  const filename = path.join(sharedPartialsDir, relativeName);
  const value = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n').trim();
  sharedVariableCache.set(key, value);
  return value;
}

export function renderLlmPrompt(name, variables = {}) {
  const template = loadPromptTemplate(name);
  const mergedVariables = {
    user_facing_tone_rules: loadSharedVariable('user_facing_tone_rules'),
    ...variables
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey || '').trim();
    const value = mergedVariables[key];
    return value === undefined || value === null ? '' : String(value);
  }).trim();
}
