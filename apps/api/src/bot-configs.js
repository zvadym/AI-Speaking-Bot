import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load bot configurations from deploy/bots/*.json
 * Returns map of bot_key -> bot config
 */
export function loadBotConfigs() {
  const botsDir = path.resolve(__dirname, '../../../deploy/bots');
  
  if (!fs.existsSync(botsDir)) {
    console.warn(`Bot configs directory not found: ${botsDir}`);
    return {};
  }

  const botConfigs = {};
  
  try {
    const files = fs.readdirSync(botsDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      try {
        const filePath = path.join(botsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content);
        
        if (config.bot_key && typeof config.bot_key === 'string') {
          botConfigs[config.bot_key] = config;
        }
      } catch (err) {
        console.warn(`Failed to load bot config ${file}:`, err.message);
      }
    }
    
    if (Object.keys(botConfigs).length > 0) {
      console.log(`Loaded ${Object.keys(botConfigs).length} bot config(s) from ${botsDir}`);
    }
  } catch (err) {
    console.warn(`Failed to read bot configs directory:`, err.message);
  }
  
  return botConfigs;
}

/**
 * Extract Telegram bot tokens from bot configs
 * Returns map of bot_key -> telegram_bot_token
 */
export function extractBotTokens() {
  const configs = loadBotConfigs();
  const tokens = {};
  
  for (const [botKey, config] of Object.entries(configs)) {
    if (config.telegram_bot_token && typeof config.telegram_bot_token === 'string') {
      const trimmed = config.telegram_bot_token.trim();
      if (trimmed && !trimmed.startsWith('YOUR_')) {
        tokens[botKey] = trimmed;
      }
    }
  }
  
  return tokens;
}
