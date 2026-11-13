import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import type { BotAiClient, ConversationAiInput } from '../src/ai/client.js';
import { executeConversation } from '../src/bot-runtime/conversation/conversation.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

const databaseUrl = process.env.BOT_RUNTIME_TEST_DATABASE_URL || '';
const migrationsDir = new URL('../../../db/migrations/', import.meta.url);
const removalMigration = '20261112190000_remove_topics.sql';

function upSql(sql: string): string {
  return sql.split('-- migrate:up')[1].split('-- migrate:down')[0];
}

test('removing topics drops their data while preserving conversations, preferences, billing and usage', {
  skip: databaseUrl ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
}, async () => {
  // The migration uses public-qualified names, so give it an isolated database
  // rather than modifying the shared integration test schema.
  const name = `topic_removal_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: isolatedUrl.toString() });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await client.connect();
    const files = (await fs.readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files.filter(file => file < removalMigration)) {
      await client.query(upSql(await fs.readFile(new URL(file, migrationsDir), 'utf8')));
    }
    await client.query(`
      INSERT INTO users (chat_id, username, plan_tier, stripe_subscription_id)
      VALUES (123, 'preserved', 'pro', 'sub_preserved');
      INSERT INTO user_bots (chat_id, bot_key, level, reply_mode, topic_enabled, topic_template_id, topic_pack_json, topic_pinned_message_id)
      VALUES (123, 'uk-en', 'b2', 'voice', true, 'coffee', '{"title_base":"Coffee"}', 99);
      INSERT INTO bot_topic_catalog (bot_key, topic_id, title_base, goal_base)
      VALUES ('uk-en', 'coffee', 'Coffee', 'Order coffee');
      INSERT INTO messages (chat_id, bot_key, role, content, topic_template_id, translation_base, follow_up_hints)
      VALUES (123, 'uk-en', 'user', 'An earlier topic conversation', 'coffee', '', '[]'),
             (123, 'uk-en', 'assistant', 'A later free conversation', NULL, 'Translation', '["Hint"]'),
             (123, 'uk-en', 'user', 'A different earlier topic', 'gym', '', '[]'),
             (456, 'uk-en', 'user', 'Private message from another learner', 'coffee', '', '[]'),
             (123, 'uk-de', 'user', 'Message in another bot', 'coffee', '', '[]');
      INSERT INTO payments (chat_id, tier, amount_cents, status, stripe_invoice_id)
      VALUES (123, 'pro', 799, 'paid', 'in_preserved');
      INSERT INTO voice_usage_events (chat_id, bot_key, direction, seconds, source)
      VALUES (123, 'uk-en', 'in', 45, 'telegram_voice_duration');
      INSERT INTO action_events (chat_id, bot_key, action_type, properties)
      VALUES (123, 'uk-en', 'topic_set', '{"topic_id":"coffee"}'),
             (123, 'uk-en', 'topic_clear', '{}'),
             (123, 'uk-en', 'topic_message_sent', '{}'),
             (123, 'uk-en', 'reply_kbd_topic_click', '{}'),
             (123, 'uk-en', 'purchase_success', '{"amount":799}');
    `);
    const preservedQueries = [
      'SELECT * FROM users ORDER BY chat_id',
      'SELECT chat_id, bot_key, level, reply_mode, is_active, first_seen_at, last_seen_at FROM user_bots ORDER BY chat_id, bot_key',
      'SELECT id, chat_id, bot_key, role, content, translation_base, follow_up_hints, created_at FROM messages ORDER BY id',
      'SELECT * FROM payments ORDER BY id',
      'SELECT * FROM voice_usage_events ORDER BY id',
      "SELECT * FROM action_events WHERE action_type NOT IN ('topic_set', 'topic_clear', 'topic_message_sent', 'reply_kbd_topic_click') ORDER BY id"
    ];
    const before = [];
    for (const query of preservedQueries) before.push((await client.query(query)).rows);
    await client.query('BEGIN');
    await client.query(upSql(await fs.readFile(new URL(removalMigration, migrationsDir), 'utf8')));
    await client.query('COMMIT');
    for (const [index, query] of preservedQueries.entries()) {
      assert.deepEqual((await client.query(query)).rows, before[index], query);
    }
    assert.equal((await client.query("SELECT to_regclass('public.bot_topic_catalog') AS name")).rows[0].name, null);
    assert.equal((await client.query("SELECT to_regclass('public.bot_topic_catalog_id_seq') AS name")).rows[0].name, null);
    assert.equal((await client.query("SELECT to_regclass('public.idx_messages_chat_bot_topic_id_desc') AS name")).rows[0].name, null);
    assert.notEqual((await client.query("SELECT to_regclass('public.idx_messages_chat_bot_id') AS name")).rows[0].name, null);
    const columns = await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('user_bots', 'messages') AND column_name LIKE 'topic_%'`);
    assert.deepEqual(columns.rows, []);
    assert.deepEqual((await client.query('SELECT action_type FROM action_events ORDER BY id')).rows,
      before[5].map(row => ({ action_type: row.action_type })));
    for (const action of ['topic_set', 'topic_clear', 'topic_message_sent', 'reply_kbd_topic_click']) {
      await assert.rejects(client.query('INSERT INTO action_events (chat_id, action_type) VALUES (123, $1)', [action]),
        (error: unknown) => (error as { code?: string }).code === '23514');
    }
    await client.query("INSERT INTO action_events (chat_id, action_type) VALUES (123, 'onboarding_completed')");

    const update = buildPreparedUpdate({botKey: 'uk-en', input: normalizeTelegramUpdate(messageUpdate({
      chatId: 123, text: 'Continue naturally', updateId: 321
    }))});
    const seen: ConversationAiInput[] = [];
    const unexpected = async () => { throw new Error('unexpected support or media call'); };
    const ai: BotAiClient = {
      async respond(input) {
        seen.push(input);
        return { detected_language: 'en', is_target_language: true, has_mistakes: false,
          reply_text: 'Of course, what happened next?', explanation_html: '' };
      },
      translate: unexpected, hints: unexpected, vocabulary: unexpected, transcribe: unexpected, speech: unexpected
    };
    const conversation = await executeConversation(client as unknown as PoolClient, update, ai, 'Continue naturally');
    assert.equal(conversation.replyMode, 'voice');
    assert.ok(conversation.assistantMessageId);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].level, 'b2');
    assert.equal('topic' in seen[0], false);
    assert.deepEqual(seen[0].history, [
      { role: 'user', content: 'An earlier topic conversation' },
      { role: 'assistant', content: 'A later free conversation' },
      { role: 'user', content: 'A different earlier topic' }
    ]);
    assert.deepEqual((await client.query(`SELECT role, content FROM messages
      WHERE chat_id = 123 AND bot_key = 'uk-en' ORDER BY id DESC LIMIT 2`)).rows, [
      { role: 'assistant', content: 'Of course, what happened next?' },
      { role: 'user', content: 'Continue naturally' }
    ]);
  } finally {
    await client.end().catch(() => {});
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
