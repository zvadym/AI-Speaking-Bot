import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkerHandlers } from '../src/jobs.js';
import { env } from '../src/env.js';
import {
  QUEUE_ONBOARDING_COMPLETE_SCAN,
  QUEUE_ONBOARDING_COMPLETE_SEND,
  QUEUE_DAY1_RETURN_SCAN,
  QUEUE_DAY1_RETURN_SEND,
  QUEUE_WEEKLY_DIGEST_SCAN,
  QUEUE_WEEKLY_DIGEST_SEND,
  QUEUE_IDIOM_PRACTICE_SCAN,
  QUEUE_IDIOM_PRACTICE_SEND,
  QUEUE_FREE_LIMIT_HALF_SCAN,
  QUEUE_FREE_LIMIT_HALF_SEND,
  QUEUE_WINBACK_SCAN,
  QUEUE_WINBACK_SEND,
  QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP,
  QUEUE_BROADCAST_RECIPIENT_SEND,
  QUEUE_DISCORD_EVENT_SEND
} from '../src/queue.js';

test('worker registration preserves queue order, options and concurrency after feature extraction', async () => {
  const registrations = [];
  const boss = {
    async work(queue, options, handler) {
      registrations.push({ queue, options, handler });
    }
  };
  await registerWorkerHandlers(boss);

  assert.deepEqual(registrations.map(({ queue }) => queue), [
    QUEUE_ONBOARDING_COMPLETE_SCAN,
    QUEUE_ONBOARDING_COMPLETE_SEND,
    QUEUE_DAY1_RETURN_SCAN,
    QUEUE_DAY1_RETURN_SEND,
    QUEUE_WEEKLY_DIGEST_SCAN,
    QUEUE_WEEKLY_DIGEST_SEND,
    QUEUE_IDIOM_PRACTICE_SCAN,
    QUEUE_IDIOM_PRACTICE_SEND,
    QUEUE_FREE_LIMIT_HALF_SCAN,
    QUEUE_FREE_LIMIT_HALF_SEND,
    QUEUE_WINBACK_SCAN,
    ...Array(3).fill(QUEUE_WINBACK_SEND),
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    ...Array(10).fill(QUEUE_LOADER_ROTATE),
    QUEUE_LOADER_TIMEOUT_CLEANUP,
    ...Array(env.broadcastSendConcurrency).fill(QUEUE_BROADCAST_RECIPIENT_SEND),
    QUEUE_DISCORD_EVENT_SEND
  ]);
  for (const { options, handler } of registrations) {
    assert.deepEqual(options, { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 });
    assert.equal(typeof handler, 'function');
    await handler([]);
  }
});
