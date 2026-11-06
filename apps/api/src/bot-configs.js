import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './private-env.js';

const defaultBotsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../deploy/bots');

/** Public metadata only. Never inject runtime credentials into these objects. */
export function loadBotConfigs({ botsDir = process.env.BOTS_DIR || defaultBotsDir } = {}) {
  const configs = {};
  for (const file of fs.readdirSync(botsDir).filter((name) => name.endsWith('.json')).sort()) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(botsDir, file), 'utf8'));
    } catch {
      throw new Error(`Invalid bot config: ${file}`);
    }
    const { telegram_bot_token: _legacyToken, ...config } = raw;
    botTokenEnvName(config.bot_key);
    if (configs[config.bot_key]) throw new Error(`Duplicate bot key: ${config.bot_key}`);
    configs[config.bot_key] = config;
  }
  return configs;
}

export function botTokenEnvName(botKey) {
  if (typeof botKey !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(botKey)) {
    throw new Error('Invalid bot key for token lookup');
  }
  return `TELEGRAM_BOT_TOKEN_${botKey.replaceAll('-', '_').toUpperCase()}`;
}

/** Resolve credentials only from the environment; inline legacy values are ignored. */
export function extractBotTokens({ configs = loadBotConfigs(), env = process.env, requireAll = false } = {}) {
  const tokens = {};
  for (const botKey of Object.keys(configs)) {
    const name = botTokenEnvName(botKey);
    const token = String(env[name] || '').trim();
    if (!token) {
      if (requireAll) throw new Error(`Missing bot credential: ${name}`);
      continue;
    }
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error(`Invalid bot credential: ${name}`);
    tokens[botKey] = token;
  }
  return tokens;
}
