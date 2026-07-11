import fs from 'node:fs';
import path from 'node:path';
import { deriveTelegramWebhookSecret } from '../dist/bot-runtime/webhook-secret.js';

const command = String(process.argv[2] || 'inspect').trim().toLowerCase();
const baseUrl = String(
  process.argv[3] ||
  process.env.TELEGRAM_WEBHOOK_BASE_URL ||
  'https://learn-language-api.notarobot.dev/telegram/webhook'
).replace(/\/+$/, '');
const signingSecret = String(process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '');
const botsDir = process.env.BOTS_DIR || '/deploy/bots';
const files = fs.readdirSync(botsDir).filter((file) => file.endsWith('.json')).sort();
const bots = files.map((file) => JSON.parse(fs.readFileSync(path.join(botsDir, file), 'utf8')));

if (command === 'set' && !signingSecret) {
  throw new Error('INTERNAL_API_SECRET or JWT_SECRET is required');
}

async function telegram(bot, method, body = null) {
  const response = await fetch(`https://api.telegram.org/bot${bot.telegram_bot_token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`${bot.bot_key}:${method}:${payload.description || response.status}`);
  }
  return payload.result;
}

for (const bot of bots) {
  if (command === 'set') {
    await telegram(bot, 'setWebhook', {
      url: `${baseUrl}/${encodeURIComponent(bot.bot_key)}`,
      secret_token: deriveTelegramWebhookSecret({
        botKey: bot.bot_key,
        botToken: bot.telegram_bot_token,
        signingSecret
      }),
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
      max_connections: 20
    });
  } else if (command !== 'inspect') {
    throw new Error(`Unknown command: ${command}`);
  }
  const info = await telegram(bot, 'getWebhookInfo');
  console.log(JSON.stringify({
    botKey: bot.bot_key,
    url: String(info.url || ''),
    pending: Number(info.pending_update_count || 0),
    lastError: info.last_error_message || null,
    allowedUpdates: info.allowed_updates || []
  }));
}
