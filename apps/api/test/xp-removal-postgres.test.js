import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import pg from 'pg';
import '../src/patch-express-async.js';
import { createRuntimeDeps } from '../src/runtime.js';
import { createApiHelpers } from '../src/services/api-helpers.js';
import { createAdminRouter } from '../src/routes/admin.js';
import { createMeRouter } from '../src/routes/me.js';
import { signSession } from '../src/auth.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { parsePreparedUpdateContract } from '../src/bot-runtime/contract-validation.js';
import { claimBotUpdateExecution } from '../src/bot-runtime/execution-repository.js';
import { createProgressHandlers } from '../src/bot-runtime/handlers/progress.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const connectionString = process.env.BOT_RUNTIME_TEST_DATABASE_URL;

test('XP-free dashboard/admin SQL and queued legacy delivery work against Postgres', {
  skip: connectionString ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
}, async () => {
  const pool = new pg.Pool({ connectionString });
  const chatId = 99_000_077;
  const query = pool.query.bind(pool);
  pool.query = (sql, ...args) => {
    assert.doesNotMatch(typeof sql === 'string' ? sql : sql.text, /\b(xp_events|user_progress|grant_xp)\b/);
    return query(sql, ...args);
  };
  const ctx = createRuntimeDeps({ pool, apiBoss: { publish: async () => null } });
  const helpers = createApiHelpers(ctx);
  const app = express();
  app.use(createAdminRouter(ctx, helpers));
  app.use(createMeRouter(ctx, helpers));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const decisionId = `v1:uk-en:${chatId}`;
  try {
    await pool.query('INSERT INTO users (chat_id) VALUES ($1)', [chatId]);
    await pool.query("INSERT INTO user_bots (chat_id, bot_key, level) VALUES ($1, 'uk-en', 'b1')", [chatId]);
    await pool.query("INSERT INTO messages (chat_id, bot_key, role, content) VALUES ($1, 'uk-en', 'user', 'I went home.')", [chatId]);
    const day = new Date().toISOString().slice(0, 10);
    const nextDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    for (const metric of ['active-users-by-day', 'active-users-by-day-by-bot', 'active-users-by-hour', 'reply-keyboard-clicks-by-day']) {
      const response = await fetch(`${base}/admin/metrics/${metric}?from=${day}&to=${nextDay}`, {
        headers: { 'X-Admin-Password': 'secret-admin' }
      });
      assert.equal(response.status, 200, `${metric}: ${await response.text()}`);
    }
    const users = await fetch(`${base}/admin/users?sort_key=xp_total`, {
      headers: { 'X-Admin-Password': 'secret-admin' }
    });
    assert.equal(users.status, 200);
    const directory = await users.json();
    assert.equal(directory.sort_key, 'created_at');
    assert.doesNotMatch(JSON.stringify(directory), /xp_total|"level":/);
    const dashboard = await fetch(`${base}/me/dashboard`, {
      headers: { Authorization: `Bearer ${signSession({ chatId, botKey: 'uk-en' })}` }
    });
    assert.equal(dashboard.status, 200, await dashboard.clone().text());
    const body = await dashboard.json();
    assert.equal('xp' in body, false);
    assert.equal(body.selected_bot.level, 'b1');

    const legacy = buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ updateId: chatId, chatId, text: '/xp' })) });
    legacy.route = 'command.xp';
    delete legacy.context.keyboard.progressButtonText;
    Object.assign(legacy.context.keyboard, { xpTotal: 340, xpLevel: 2, xpButtonText: '· XP: 340 • L2' });
    const parsed = parsePreparedUpdateContract(JSON.parse(JSON.stringify(legacy)));
    await claimBotUpdateExecution(pool, { contract: parsed, handlerVersion: 1, jobId: '00000000-0000-4000-8000-000000000077' });
    let sends = 0;
    const handler = createProgressHandlers({
      pool, getBotLocale: ctx.getBotLocale,
      telegramClient: { async sendTelegramTextMessage(_chatId, text, options) {
        sends += 1;
        assert.match(text, /Навчальний прогрес поки недоступний/);
        assert.doesNotMatch(JSON.stringify(options.replyMarkup), /XP/);
        return { message_id: 77 };
      } }
    }).find((item) => item.route === 'command.xp');
    assert.equal((await handler.execute(parsed)).status, 'delivered');
    assert.equal((await handler.execute(parsed)).status, 'duplicate');
    assert.equal(sends, 1);
  } finally {
    server.close();
    await once(server, 'close');
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id = $1', [decisionId]);
    await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM action_events WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM user_bots WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM users WHERE chat_id = $1', [chatId]);
    await pool.end();
  }
});
