import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../../../resources/prompts/', import.meta.url));
const promptCache = new Map<string, string>();

export function promptResourcePath(name: string): string {
  const override = String(process.env.BOT_RUNTIME_PROMPTS_DIR || '').trim();
  const directory = override && fs.existsSync(override) ? override : defaultDirectory;
  return path.join(directory, `${name}.md`);
}

export function loadLlmPrompt(name: string): string {
  const key = String(name || '').trim();
  if (!key) throw new Error('Prompt template name is required');
  const filename = promptResourcePath(key);
  const cached = promptCache.get(filename);
  if (cached !== undefined) return cached;
  const template = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  promptCache.set(filename, template);
  return template;
}

export function renderLlmPrompt(
  name: string,
  variables: Record<string, unknown> = {},
  { botTemplate = false }: { botTemplate?: boolean } = {}
): string {
  const template = loadLlmPrompt(name);
  const mergedVariables: Record<string, unknown> = {
    user_facing_tone_rules: loadLlmPrompt('shared/user-facing-tone').trim(),
    ...variables
  };
  // Bot templates historically trim before substitution and accept identifier keys;
  // notification/idiom templates trim the result and also accept numeric keys.
  const pattern = botTemplate
    ? /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
    : /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const rendered = (botTemplate ? template.trim() : template).replace(pattern, (_, key: string) => {
    const value = mergedVariables[key];
    return botTemplate ? String(value || '') : value === undefined || value === null ? '' : String(value);
  });
  return botTemplate ? rendered : rendered.trim();
}
