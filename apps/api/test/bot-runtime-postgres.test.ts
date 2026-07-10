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
import type { PreparedUpdate } from '../src/bot-runtime/contracts.js';
import { normalizeTelegramUpdate } from '../src/bot-runtime/telegram-update.js';
import { buildPreparedUpdate } from '../src/bot-runtime/update-router.js';
import { messageUpdate } from './fixtures/telegram-updates.js';

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
  } finally {
    try {
      await pool.query(
        `DELETE FROM bot_update_executions
         WHERE decision_id = ANY($1::text[])`,
        [[
          contract.decisionId,
          `v1:uk-en:${updateId + 1}`,
          `v1:uk-en:${updateId + 2}`
        ]]
      );
    } finally {
      await pool.end();
    }
  }
});
