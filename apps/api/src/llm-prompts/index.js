import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const promptsDir = path.dirname(fileURLToPath(import.meta.url));
const promptCache = new Map();

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

export function renderLlmPrompt(name, variables = {}) {
  const template = loadPromptTemplate(name);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey || '').trim();
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  }).trim();
}
