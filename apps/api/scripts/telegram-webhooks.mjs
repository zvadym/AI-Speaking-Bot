import { loadBotConfigs, extractBotTokens } from '../dist/bot-configs.js';
import { deriveTelegramWebhookSecret } from '../dist/bot-runtime/webhook-secret.js';

const command = String(process.argv[2] || 'inspect').trim().toLowerCase();
const baseUrl = String(
  process.argv[3] ||
  process.env.TELEGRAM_WEBHOOK_BASE_URL ||
  (process.env.API_BASE_URL ? `${process.env.API_BASE_URL.replace(/\/+$/, '')}/telegram/webhook` : '')
).replace(/\/+$/, '');
const signingSecret = String(process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '');
if (!['set', 'inspect'].includes(command)) throw new Error(`Unknown command: ${command}`);
const configs = loadBotConfigs();
const tokens = extractBotTokens({ configs, requireAll: true });
const bots = Object.values(configs);
if (!bots.length) throw new Error('No bot configs found');
if (command === 'set' && !baseUrl) throw new Error('API_BASE_URL or TELEGRAM_WEBHOOK_BASE_URL is required');

if (command === 'set' && !signingSecret) {
  throw new Error('INTERNAL_API_SECRET or JWT_SECRET is required');
}

async function telegram(bot, method, body = null) {
  const response = await fetch(`https://api.telegram.org/bot${tokens[bot.bot_key]}/${method}`, {
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
        botToken: tokens[bot.bot_key],
        signingSecret
      }),
      allowed_updates: ['message', 'callback_query', 'widget_query'],
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
