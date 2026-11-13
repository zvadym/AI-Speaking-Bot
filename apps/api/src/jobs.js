import { createProgressService } from './bot-runtime/middleware/progress-service.js';
import { pool } from './db.js';
import { telegramClient } from './notifications/telegram.js';
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
} from './queue.js';
import { handleOnboardingCompleteScan, handleOnboardingCompleteSend } from './notifications/onboarding.js';
import { handleDay1ReturnScan, handleDay1ReturnSend } from './notifications/day1-return.js';
import { handleWeeklyDigestScan, handleWeeklyDigestSend } from './notifications/weekly-digest.js';
import { handleIdiomPracticeScan, handleIdiomPracticeSend } from './idioms/practice.js';
import { handleFreeLimitHalfScan, handleFreeLimitHalfSend } from './notifications/free-limit-half.js';
import { handleWinbackScan, handleWinbackSend } from './notifications/winback.js';
import { handleBroadcastCampaignEnqueue, handleBroadcastRecipientSend } from './broadcasts/campaigns.js';
import { env } from './env.js';
import { handleDiscordEventSend } from './notifications/discord-events.js';

const WINBACK_SEND_CONCURRENCY = 3;

const LOADER_ROTATE_CONCURRENCY = 10;

async function handleLoaderRotate(jobs, progressService) {
  for (const job of jobs) {
    await progressService.rotate(job.data);
  }
}

async function handleLoaderTimeoutCleanup(jobs, progressService) {
  for (const job of jobs) {
    await progressService.timeout(job.data);
  }
}

export async function registerWorkerHandlers(boss) {
  const progressService = createProgressService({ pool, boss, telegramClient });

  await boss.work(
    QUEUE_ONBOARDING_COMPLETE_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleOnboardingCompleteScan(jobs, boss)
  );

  await boss.work(
    QUEUE_ONBOARDING_COMPLETE_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleOnboardingCompleteSend
  );

  await boss.work(
    QUEUE_DAY1_RETURN_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleDay1ReturnScan(jobs, boss)
  );

  await boss.work(
    QUEUE_DAY1_RETURN_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleDay1ReturnSend
  );

  await boss.work(
    QUEUE_WEEKLY_DIGEST_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleWeeklyDigestScan(jobs, boss)
  );

  await boss.work(
    QUEUE_WEEKLY_DIGEST_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleWeeklyDigestSend
  );

  await boss.work(
    QUEUE_IDIOM_PRACTICE_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleIdiomPracticeScan(jobs, boss)
  );

  await boss.work(
    QUEUE_IDIOM_PRACTICE_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleIdiomPracticeSend
  );

  await boss.work(
    QUEUE_FREE_LIMIT_HALF_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleFreeLimitHalfScan(jobs, boss)
  );

  await boss.work(
    QUEUE_FREE_LIMIT_HALF_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleFreeLimitHalfSend
  );

  await boss.work(
    QUEUE_WINBACK_SCAN,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleWinbackScan(jobs, boss)
  );

  for (let idx = 0; idx < WINBACK_SEND_CONCURRENCY; idx += 1) {
    await boss.work(
      QUEUE_WINBACK_SEND,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleWinbackSend
    );
  }

  await boss.work(
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleBroadcastCampaignEnqueue(jobs, boss)
  );

  for (let idx = 0; idx < LOADER_ROTATE_CONCURRENCY; idx += 1) {
    await boss.work(
      QUEUE_LOADER_ROTATE,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      (jobs) => handleLoaderRotate(jobs, progressService)
    );
  }

  await boss.work(
    QUEUE_LOADER_TIMEOUT_CLEANUP,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    (jobs) => handleLoaderTimeoutCleanup(jobs, progressService)
  );

  for (let idx = 0; idx < env.broadcastSendConcurrency; idx += 1) {
    await boss.work(
      QUEUE_BROADCAST_RECIPIENT_SEND,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
      handleBroadcastRecipientSend
    );
  }

  await boss.work(
    QUEUE_DISCORD_EVENT_SEND,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    handleDiscordEventSend
  );
}
