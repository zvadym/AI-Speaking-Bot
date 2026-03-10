import { PgBoss } from 'pg-boss';
import { env } from './env.js';

export const QUEUE_ONBOARDING_COMPLETE_SCAN = 'onboarding-complete-scan';
export const QUEUE_ONBOARDING_COMPLETE_SEND = 'onboarding-complete-send';
export const QUEUE_BROADCAST_CAMPAIGN_ENQUEUE = 'broadcast-campaign-enqueue';
export const QUEUE_BROADCAST_RECIPIENT_SEND = 'broadcast-recipient-send';

const ssl = env.databaseSsl
  ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
  : undefined;

const retryOptions = {
  retryLimit: env.jobRetryMaxAttempts,
  retryDelay: 30,
  retryBackoff: true
};

let apiBossPromise = null;
let workerBossPromise = null;

async function ensureQueues(boss) {
  await boss.createQueue(QUEUE_ONBOARDING_COMPLETE_SCAN);
  await boss.createQueue(QUEUE_ONBOARDING_COMPLETE_SEND, retryOptions);
  await boss.createQueue(QUEUE_BROADCAST_CAMPAIGN_ENQUEUE, retryOptions);
  await boss.createQueue(QUEUE_BROADCAST_RECIPIENT_SEND, retryOptions);
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
