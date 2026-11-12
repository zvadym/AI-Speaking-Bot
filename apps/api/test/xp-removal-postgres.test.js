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
import { processBotUpdateJob } from '../src/bot-runtime/register-worker.js';
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
  const decisionIds = [chatId, chatId + 1].map((id) => `v1:uk-en:${id}`);
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

    for (const [index, route] of ['command.xp', 'command.progress'].entries()) {
      const legacy = buildPreparedUpdate({ botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({ updateId: chatId + index, chatId, text: '/xp' })) });
      legacy.route = route;
      Object.assign(legacy.context.keyboard, { xpTotal: 340, xpLevel: 2, xpButtonText: '· XP: 340 • L2' });
      const result = await processBotUpdateJob({id:'legacy',data:{contract:legacy,handlerVersion:1}}, {
        pool,registry:{get(){throw new Error('No retired handler may run');}}
      });
      assert.equal(result,'retired_job');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM bot_update_executions WHERE decision_id=$1',[legacy.decisionId])).rows[0].n,0);
    }
  } finally {
    server.close();
    await once(server, 'close');
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id = ANY($1)', [decisionIds]);
    await pool.query('DELETE FROM messages WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM action_events WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM user_bots WHERE chat_id = $1', [chatId]);
    await pool.query('DELETE FROM users WHERE chat_id = $1', [chatId]);
    await pool.end();
  }
});
