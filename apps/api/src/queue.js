import { PgBoss } from 'pg-boss';
import { env } from './env.js';
import { captureException } from './sentry.js';
import { BOT_UPDATE_QUEUE_NAME, BOT_SETTINGS_QUEUE_NAME } from './bot-runtime/contracts.js';
import {
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP
} from './bot-runtime/progress-queue.js';

export {
  QUEUE_LOADER_ROTATE,
  QUEUE_LOADER_TIMEOUT_CLEANUP
} from './bot-runtime/progress-queue.js';

export const QUEUE_ONBOARDING_COMPLETE_SCAN = 'onboarding-complete-scan';
export const QUEUE_ONBOARDING_COMPLETE_SEND = 'onboarding-complete-send';
export const QUEUE_DAY1_RETURN_SCAN = 'day1-return-scan';
export const QUEUE_DAY1_RETURN_SEND = 'day1-return-send';
export const QUEUE_WEEKLY_DIGEST_SCAN = 'weekly-digest-scan';
export const QUEUE_WEEKLY_DIGEST_SEND = 'weekly-digest-send';
export const QUEUE_IDIOM_PRACTICE_SCAN = 'idiom-practice-scan';
export const QUEUE_IDIOM_PRACTICE_SEND = 'idiom-practice-send';
export const QUEUE_FREE_LIMIT_HALF_SCAN = 'free-limit-half-scan';
export const QUEUE_FREE_LIMIT_HALF_SEND = 'free-limit-half-send';
export const QUEUE_BROADCAST_CAMPAIGN_ENQUEUE = 'broadcast-campaign-enqueue';
export const QUEUE_BROADCAST_RECIPIENT_SEND = 'broadcast-recipient-send';
export const QUEUE_WINBACK_SCAN = 'winback-scan';
export const QUEUE_WINBACK_SEND = 'winback-send';
export const QUEUE_DISCORD_EVENT_SEND = 'discord-event-send';
export const QUEUE_BOT_UPDATE_PROCESS = BOT_UPDATE_QUEUE_NAME;

const ssl = env.databaseSsl
  ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
  : undefined;

const retryOptions = {
  retryLimit: env.jobRetryMaxAttempts,
  retryDelay: 30,
  retryBackoff: true
};
const IDIOM_PRACTICE_SCHEDULE_KEY = 'daily-hours-v2';

let apiBossPromise = null;
let workerBossPromise = null;

async function ensureQueues(boss) {
  await boss.createQueue(QUEUE_ONBOARDING_COMPLETE_SCAN);
  await boss.createQueue(QUEUE_ONBOARDING_COMPLETE_SEND, retryOptions);
  await boss.createQueue(QUEUE_DAY1_RETURN_SCAN);
  await boss.createQueue(QUEUE_DAY1_RETURN_SEND, retryOptions);
  await boss.createQueue(QUEUE_WEEKLY_DIGEST_SCAN);
  await boss.createQueue(QUEUE_WEEKLY_DIGEST_SEND, retryOptions);
  await boss.createQueue(QUEUE_IDIOM_PRACTICE_SCAN);
  await boss.createQueue(QUEUE_IDIOM_PRACTICE_SEND, retryOptions);
  await boss.createQueue(QUEUE_FREE_LIMIT_HALF_SCAN);
  await boss.createQueue(QUEUE_FREE_LIMIT_HALF_SEND, retryOptions);
  await boss.createQueue(QUEUE_BROADCAST_CAMPAIGN_ENQUEUE, retryOptions);
  await boss.createQueue(QUEUE_BROADCAST_RECIPIENT_SEND, retryOptions);
  await boss.createQueue(QUEUE_WINBACK_SCAN);
  await boss.createQueue(QUEUE_WINBACK_SEND, retryOptions);
  await boss.createQueue(QUEUE_LOADER_ROTATE);
  await boss.createQueue(QUEUE_LOADER_TIMEOUT_CLEANUP);
  await boss.createQueue(QUEUE_DISCORD_EVENT_SEND, retryOptions);
  await boss.createQueue(BOT_SETTINGS_QUEUE_NAME, {
    ...retryOptions,
    retryDelay: 1,
    policy: 'exclusive',
    expireInSeconds: 120
  });
  await boss.createQueue(QUEUE_BOT_UPDATE_PROCESS, {
    ...retryOptions,
    policy: 'exclusive',
    expireInSeconds: 120
  });
}

function createBoss({ enableScheduling }) {
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    ssl,
    supervise: enableScheduling,
    schedule: enableScheduling
  });

  boss.on('error', (error) => {
    console.error('pg-boss error', { error: error?.message || String(error) });
    captureException(error, { tags: { subsystem: 'pg-boss' } });
  });

  boss.on('warning', (warning) => {
    console.warn('pg-boss warning', { warning: warning?.message || String(warning) });
  });

  return boss;
}

export function defaultRetryOptions(overrides = {}) {
  return {
    ...retryOptions,
    ...overrides
  };
}

export async function getApiBoss() {
  if (!apiBossPromise) {
    apiBossPromise = (async () => {
      const boss = createBoss({ enableScheduling: false });
      await boss.start();
      await ensureQueues(boss);
      return boss;
    })();
  }

  return apiBossPromise;
}

export async function stopApiBoss() {
  if (!apiBossPromise) return;
  const boss = await apiBossPromise;
  apiBossPromise = null;
  await boss.stop({ graceful: true, timeout: 30000 });
}

export async function startWorkerBoss() {
  if (!workerBossPromise) {
    workerBossPromise = (async () => {
      const boss = createBoss({ enableScheduling: true });
      await boss.start();
      await ensureQueues(boss);
      await boss.schedule(
        QUEUE_ONBOARDING_COMPLETE_SCAN,
        '*/2 * * * *',
        {},
        { key: 'default' }
      );
      await boss.schedule(
        QUEUE_DAY1_RETURN_SCAN,
        '10 * * * *',
        {},
        { key: 'default' }
      );
      await boss.schedule(
        QUEUE_WEEKLY_DIGEST_SCAN,
        '20 * * * *',
        {},
        { key: 'default' }
      );
      await boss.unschedule(QUEUE_IDIOM_PRACTICE_SCAN, 'default');
      await boss.schedule(
        QUEUE_IDIOM_PRACTICE_SCAN,
        `${env.idiomPracticeSendMinuteUtc} ${env.idiomPracticeSendHoursUtc.join(',')} * * *`,
        {},
        { key: IDIOM_PRACTICE_SCHEDULE_KEY }
      );
      await boss.schedule(
        QUEUE_FREE_LIMIT_HALF_SCAN,
        '*/2 * * * *',
        {},
        { key: 'default' }
      );
      await boss.schedule(
        QUEUE_WINBACK_SCAN,
        '0 * * * *',
        {},
        { key: 'default' }
      );
      return boss;
    })();
  }

  return workerBossPromise;
}

export async function stopWorkerBoss() {
  if (!workerBossPromise) return;
  const boss = await workerBossPromise;
  workerBossPromise = null;
  await boss.stop({ graceful: true, timeout: 30000 });
}
