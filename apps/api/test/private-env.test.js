import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { botTokenEnvName, extractBotTokens, loadBotConfigs } from '../src/bot-configs.js';
import { loadPrivateEnv } from '../src/private-env.js';

const token = `100000000:${'x'.repeat(35)}`;

test('tracked bot configs contain no inline credentials', () => {
  const directory = new URL('../../../deploy/bots/', import.meta.url);
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const raw = JSON.parse(fs.readFileSync(new URL(filename, directory), 'utf8'));
    assert.equal(Object.hasOwn(raw, 'telegram_bot_token'), false, `Remove inline credential field from ${filename}`);
  }
});

test('bot credentials are independent from public metadata and never fall back to JSON', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'uk-en.json'), JSON.stringify({ bot_key: 'uk-en', telegram_bot_token: token, locale: {} }));
  const configs = loadBotConfigs({ botsDir: dir });
  assert.deepEqual(configs, { 'uk-en': { bot_key: 'uk-en', locale: {} } });
  assert.deepEqual(extractBotTokens({ configs, env: {} }), {});
  assert.throws(() => extractBotTokens({ configs, env: {}, requireAll: true }), /TELEGRAM_BOT_TOKEN_UK_EN/);
  assert.deepEqual(extractBotTokens({ configs, env: { TELEGRAM_BOT_TOKEN_UK_EN: token }, requireAll: true }), { 'uk-en': token });
  assert.equal(botTokenEnvName('uk-en'), 'TELEGRAM_BOT_TOKEN_UK_EN');
  assert.throws(() => botTokenEnvName('uk_en'), /Invalid bot key/);
});

test('preflight rejects any missing or malformed credential without disclosing its value', () => {
  const configs = { 'uk-en': {}, 'uk-de': {} };
  const env = { TELEGRAM_BOT_TOKEN_UK_EN: token };
  assert.throws(() => extractBotTokens({ configs, env, requireAll: true }), /TELEGRAM_BOT_TOKEN_UK_DE/);
  env.TELEGRAM_BOT_TOKEN_UK_DE = 'do-not-print-this-value';
  assert.throws(() => extractBotTokens({ configs, env }), (error) => {
    assert.match(error.message, /Invalid bot credential/);
    assert.ok(!error.message.includes(env.TELEGRAM_BOT_TOKEN_UK_DE));
    return true;
  });
});

test('private env uses explicit external files, preserves process overrides and rejects checkout paths', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-env-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const file = path.join(dir, 'api.env');
  fs.writeFileSync(file, "KEY=from-file\nLITERAL='$(touch unsafe) $HOME `id`'\n", { mode: 0o600 });
  const env = { API_ENV_FILE: file, KEY: 'override' };
  loadPrivateEnv({ env, repoRoot: repo });
  assert.equal(env.KEY, 'override');
  assert.equal(env.LITERAL, '$(touch unsafe) $HOME `id`');
  assert.doesNotThrow(() => loadPrivateEnv({ env: {}, repoRoot: repo }));
  assert.throws(() => loadPrivateEnv({ env: { API_ENV_FILE: 'relative.env' }, repoRoot: repo }), /absolute path/);
  const inside = path.join(repo, 'api.env');
  fs.writeFileSync(inside, 'KEY=value', { mode: 0o600 });
  const link = path.join(dir, 'alias.env');
  fs.symlinkSync(inside, link);
  assert.throws(() => loadPrivateEnv({ env: { API_ENV_FILE: link }, repoRoot: repo }), /outside the repository/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => loadPrivateEnv({ env: { API_ENV_FILE: file }, repoRoot: repo }), /0600/);
});
