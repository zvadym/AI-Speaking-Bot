import fs from 'node:fs';

// Never load a developer's external env or use inherited service credentials.
delete process.env.API_ENV_FILE;
delete process.env.BOTS_DIR;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('TELEGRAM_BOT_TOKEN')) delete process.env[key];
}
Object.assign(process.env, {
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/test_db',
  WEBAPP_URL: 'https://example.test/app',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  JWT_SECRET: 'jwt_secret_for_tests',
  INTERNAL_API_SECRET: 'internal-secret',
  ADMIN_DASHBOARD_PASSWORD: 'secret-admin',
  OPENAI_API_KEY: '',
  SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
  SENTRY_TEST_MODE: '1',
  DISCORD_EVENTS_WEBHOOK_URL: 'https://discord.test/api/webhooks/123'
});
const botsDir = new URL('../../../deploy/bots/', import.meta.url);
for (const file of fs.readdirSync(botsDir).filter((name) => name.endsWith('.json'))) {
  const { bot_key: key } = JSON.parse(fs.readFileSync(new URL(file, botsDir), 'utf8'));
  process.env[`TELEGRAM_BOT_TOKEN_${key.replaceAll('-', '_').toUpperCase()}`] = `100000000:${'x'.repeat(35)}`;
}
