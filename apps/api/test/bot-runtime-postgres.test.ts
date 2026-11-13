import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  beginBotUpdateDelivery,
  markBotUpdateDeliveryDelivered
} from '../src/bot-runtime/delivery-repository.js';
import {
  claimBotUpdateExecution,
  markBotUpdateExecutionSucceeded
} from '../src/bot-runtime/execution-repository.js';
import { runBotUpdateEffect } from '../src/bot-runtime/effect-repository.js';
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { callbackUpdate, messageUpdate } from './fixtures/telegram-updates.js';
import { createSupportCallbackHandlers } from '../src/bot-runtime/handlers/support-callbacks.js';
import { BotRuntimeHandlerError } from '../src/bot-runtime/handler-registry.js';
import type { BotAiClient } from '../src/bot-runtime/bot-ai.js';

const databaseUrl = process.env.BOT_RUNTIME_TEST_DATABASE_URL || '';

function preparedStats(updateId: number): PreparedUpdate {
  return buildPreparedUpdate({
    botKey: 'uk-en',
    input: normalizeTelegramUpdate(messageUpdate({ updateId, text: '/stats' }))
  });
}

test('execution claims and delivery attempts are durable under concurrency', {
  skip: databaseUrl ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
}, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const updateId = 9_000_000 + Math.floor(Math.random() * 500_000);
  const contract = preparedStats(updateId);
  const firstJobId = '00000000-0000-4000-8000-000000000011';
  const secondJobId = '00000000-0000-4000-8000-000000000012';

  try {
    const claims = await Promise.all([
      claimBotUpdateExecution(pool, { contract, handlerVersion: 1, jobId: firstJobId }),
      claimBotUpdateExecution(pool, { contract, handlerVersion: 1, jobId: secondJobId })
    ]);
    assert.equal(claims.filter((claim) => claim.outcome === 'claimed').length, 1);
    assert.equal(claims.filter((claim) => claim.outcome === 'in_progress').length, 1);

    const winner = claims[0].outcome === 'claimed' ? firstJobId : secondJobId;
    await markBotUpdateExecutionSucceeded(pool, contract.decisionId, winner);
    assert.deepEqual(
      await claimBotUpdateExecution(pool, {
        contract,
        handlerVersion: 1,
        jobId: '00000000-0000-4000-8000-000000000013'
      }),
      { outcome: 'succeeded' }
    );

    const secondContract = preparedStats(updateId + 1);
    await claimBotUpdateExecution(pool, {
      contract: secondContract,
      handlerVersion: 1,
      jobId: '00000000-0000-4000-8000-000000000014'
    });
    const attempt = await beginBotUpdateDelivery(pool, {
      decisionId: secondContract.decisionId,
      stepKey: 'stats-message:v1',
      telegramMethod: 'sendMessage'
    });
    assert.equal(attempt.action, 'send');
    if (attempt.action !== 'send') throw new Error('expected send action');
    await markBotUpdateDeliveryDelivered(pool, attempt.deliveryId, 4321);
    assert.deepEqual(
      await beginBotUpdateDelivery(pool, {
        decisionId: secondContract.decisionId,
        stepKey: 'stats-message:v1',
        telegramMethod: 'sendMessage'
      }),
      { action: 'delivered', deliveryId: attempt.deliveryId, telegramMessageId: 4321 }
    );

    const thirdContract = preparedStats(updateId + 2);
    await claimBotUpdateExecution(pool, {
      contract: thirdContract,
      handlerVersion: 1,
      jobId: '00000000-0000-4000-8000-000000000015'
    });
    const unfinished = await beginBotUpdateDelivery(pool, {
      decisionId: thirdContract.decisionId,
      stepKey: 'stats-message:v1',
      telegramMethod: 'sendMessage'
    });
    assert.equal(unfinished.action, 'send');
    const reconciled = await beginBotUpdateDelivery(pool, {
      decisionId: thirdContract.decisionId,
      stepKey: 'stats-message:v1',
      telegramMethod: 'sendMessage'
    });
    assert.equal(reconciled.action, 'unknown');
    if (reconciled.action === 'unknown') {
      assert.equal(reconciled.errorCode, 'previous_attempt_incomplete');
    }

    const fourthContract = preparedStats(updateId + 3);
    await claimBotUpdateExecution(pool, {
      contract: fourthContract,
      handlerVersion: 1,
      jobId: '00000000-0000-4000-8000-000000000016'
    });
    let effectCalls = 0;
    const effects = await Promise.all([
      runBotUpdateEffect(pool, {
        decisionId: fourthContract.decisionId,
        stepKey: 'test-effect:v1',
        execute: async (client) => {
          effectCalls += 1;
          await client.query('SELECT pg_sleep(0.05)');
          return { value: 42 };
        }
      }),
      runBotUpdateEffect(pool, {
        decisionId: fourthContract.decisionId,
        stepKey: 'test-effect:v1',
        execute: async () => {
          effectCalls += 1;
          return { value: 99 };
        }
      })
    ]);
    assert.equal(effectCalls, 1);
    assert.equal(effects.filter((effect) => effect.duplicate).length, 1);
    assert.equal(effects[0].result.value, effects[1].result.value);
    assert.equal([42, 99].includes(Number(effects[0].result.value)), true);
  } finally {
    try {
      await pool.query(
        `DELETE FROM bot_update_executions
         WHERE decision_id = ANY($1::text[])`,
        [[
          contract.decisionId,
          `v1:uk-en:${updateId + 1}`,
          `v1:uk-en:${updateId + 2}`,
          `v1:uk-en:${updateId + 3}`
        ]]
      );
    } finally {
      await pool.end();
    }
  }
});

test('support graphs preserve atomic caches, scoped ownership and durable hint/vocabulary delivery', {
  skip: databaseUrl ? false : 'BOT_RUNTIME_TEST_DATABASE_URL is not configured'
}, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const chatId = 8_000_000_000 + Math.floor(Math.random() * 500_000);
  const contracts: PreparedUpdate[] = [];
  let translations = 0;
  let hints = 0;
  let vocabulary = 0;
  let acknowledgements = 0;
  const sent: string[] = [];
  const edits: string[] = [];
  const handlers = createSupportCallbackHandlers({
    pool, getBotLocale: () => ({}),
    ai: {
      async translate(_botKey: string, content: string) { translations++; assert.equal(content, 'Hello there'); return 'Привіт'; },
      async hints(input: Parameters<BotAiClient['hints']>[0]) {
        hints++; assert.equal(input.assistantReply, 'Hello there');
        assert.equal(input.userMessage, 'How are you?'); assert.equal(input.level, 'b1');
        return { question: 'How is your day?', useful_phrases: [] };
      },
      async vocabulary(_botKey: string, content: string) { vocabulary++; assert.equal(content, 'Hello there'); return []; }
    } as unknown as BotAiClient,
    telegramClient: {
      async answerTelegramCallbackQuery() { acknowledgements++; throw new Error('expired ephemeral acknowledgement'); },
      async callTelegramApi(_botKey, method) { sent.push(method); return { message_id: 72 }; },
      async sendTelegramTextMessage(_chat, text) { sent.push(text); return { message_id: 71 }; },
      async editTelegramMessageText(_chat, _id, text) { edits.push(text); return {}; },
      async editTelegramMessageReplyMarkup() { return {}; }
    }
  });
  async function prepare(data: string, botKey = 'uk-en', callbackChatId = chatId) {
    const contract = buildPreparedUpdate({ botKey, input: normalizeTelegramUpdate(callbackUpdate({
      data, chatId: callbackChatId, updateId: chatId + contracts.length
    })) });
    contracts.push(contract);
    await claimBotUpdateExecution(pool, { contract, handlerVersion: 1,
      jobId: '00000000-0000-4000-8000-000000000021' });
    return contract;
  }
  const execute = (contract: PreparedUpdate) => handlers.find(handler => handler.route === contract.route)!.execute(contract);
  try {
    await pool.query('INSERT INTO users (chat_id) VALUES ($1), ($2)', [chatId, chatId + 1]);
    await pool.query(`INSERT INTO user_bots (chat_id, bot_key, level)
      VALUES ($1, 'uk-en', 'b1'), ($1, 'en-de', 'b1'), ($2, 'uk-en', 'a1')`, [chatId, chatId + 1]);
    await pool.query(`INSERT INTO messages (chat_id, bot_key, role, content)
      VALUES ($1, 'uk-en', 'user', 'How are you?')`, [chatId]);
    const assistantId = Number((await pool.query(`INSERT INTO messages (chat_id, bot_key, role, content)
      VALUES ($1, 'uk-en', 'assistant', 'Hello there') RETURNING id`, [chatId])).rows[0].id);

    const translation = await prepare(`tr:${assistantId}:000`);
    await Promise.all([execute(translation), execute(translation)]);
    await execute(await prepare(`tr:${assistantId}:000`));
    assert.equal(translations, 1);
    assert.ok(edits.every(text => text.includes('Привіт')));

    const hint = await prepare(`hint:${assistantId}:100`);
    assert.equal((await execute(hint)).status, 'delivered');
    assert.equal((await execute(hint)).status, 'duplicate');
    await execute(await prepare(`hint:${assistantId}:100`));
    assert.equal(hints, 1);
    assert.equal(sent.length, 2); // A new callback may send the cached hints again.

    const vocab = await prepare(`voc:${assistantId}:110`);
    assert.equal((await execute(vocab)).status, 'delivered');
    assert.equal((await execute(vocab)).status, 'duplicate');
    assert.equal(vocabulary, 1);
    assert.deepEqual(sent.slice(2), ['sendRichMessage']);

    const beforeUnownedEdits = edits.length;
    for (const unowned of [await prepare(`tr:${assistantId}:000`, 'en-de'),
      await prepare(`hint:${assistantId}:000`, 'uk-en', chatId + 1)]) {
      await assert.rejects(execute(unowned), error => error instanceof BotRuntimeHandlerError
        && error.code === 'assistant_message_not_found' && !error.retryable);
      assert.equal((await pool.query('SELECT 1 FROM bot_update_effects WHERE decision_id=$1', [unowned.decisionId])).rowCount, 0);
    }
    assert.equal(edits.length, beforeUnownedEdits);
    assert.equal(translations, 1); assert.equal(hints, 1); assert.equal(vocabulary, 1);
    assert.equal(acknowledgements, 10);
    const stored = (await pool.query('SELECT translation_base, follow_up_hints FROM messages WHERE id=$1', [assistantId])).rows[0];
    assert.equal(stored.translation_base, 'Привіт');
    assert.equal(JSON.parse(stored.follow_up_hints).question, 'How is your day?');
    const keys = (await pool.query('SELECT step_key FROM bot_update_effects WHERE decision_id=ANY($1::text[])',
      [contracts.map(contract => contract.decisionId)])).rows.map(row => row.step_key);
    assert.deepEqual(keys.sort(), ['callback.hints:state:v1', 'callback.hints:state:v1',
      'callback.translate:state:v1', 'callback.translate:state:v1', 'callback.vocab:ai:v1']);
  } finally {
    await pool.query('DELETE FROM bot_update_executions WHERE decision_id=ANY($1::text[])', [contracts.map(contract => contract.decisionId)]);
    await pool.query('DELETE FROM messages WHERE chat_id=ANY($1::bigint[])', [[chatId, chatId + 1]]);
    await pool.query('DELETE FROM users WHERE chat_id=ANY($1::bigint[])', [[chatId, chatId + 1]]);
    await pool.end();
  }
});
