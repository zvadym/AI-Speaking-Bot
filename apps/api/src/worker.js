import './instrument-worker.js';
import { registerWorkerHandlers } from './jobs.js';
import { startWorkerBoss, stopWorkerBoss } from './queue.js';
import { captureException, flushSentry } from './sentry.js';

let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Worker shutting down on ${signal}`);
  await stopWorkerBoss();
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .then(async () => {
      await flushSentry(2000);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Worker shutdown failed', error);
      captureException(error, { tags: { phase: 'shutdown', signal: 'SIGINT' } });
      flushSentry(2000).finally(() => process.exit(1));
    });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
    .then(async () => {
      await flushSentry(2000);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Worker shutdown failed', error);
      captureException(error, { tags: { phase: 'shutdown', signal: 'SIGTERM' } });
      flushSentry(2000).finally(() => process.exit(1));
    });
});

try {
  const boss = await startWorkerBoss();
  await registerWorkerHandlers(boss);
  console.log('Worker started');
} catch (error) {
  console.error('Worker startup failed', error);
  captureException(error, { tags: { phase: 'startup' } });
  await flushSentry(2000);
  process.exit(1);
}
