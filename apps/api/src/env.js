import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalUrl(name) {
  const value = process.env[name];
  if (!value) return '';
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid URL in env var: ${name}`);
  }
  return value;
}

const port = Number(process.env.API_PORT || 3000);
const telegramInitDataMaxAgeSec = Number(process.env.TELEGRAM_INITDATA_MAX_AGE || 86400);
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const sslEnabled = (process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const sslRejectUnauthorized = (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';

const webappUrl = requireEnv('WEBAPP_URL');
const webappReturnUrlRaw = optionalUrl('WEBAPP_RETURN_URL');

export const env = {
  port,
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${port}`,
  webappUrl,
  webappReturnUrl: webappReturnUrlRaw || webappUrl,
  webappReturnUrlIsCustom: Boolean(webappReturnUrlRaw),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseSsl: sslEnabled,
  databaseSslRejectUnauthorized: sslRejectUnauthorized,
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramInitDataMaxAgeSec,
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: requireEnv('STRIPE_WEBHOOK_SECRET'),
  stripePortalConfigId: process.env.STRIPE_PORTAL_CONFIG_ID || '',
  jwtSecret: requireEnv('JWT_SECRET'),
  corsOrigins,
  planChangedWebhookUrl: process.env.PLAN_CHANGED_WEBHOOK_URL || ''
};
