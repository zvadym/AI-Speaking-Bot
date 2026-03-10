import { registerWorkerHandlers } from './jobs.js';
import { startWorkerBoss, stopWorkerBoss } from './queue.js';

let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Worker shutting down on ${signal}`);
  try {
    await stopWorkerBoss();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Worker shutdown failed', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Worker shutdown failed', error);
    process.exit(1);
  });
});

const boss = await startWorkerBoss();
await registerWorkerHandlers(boss);

console.log('Worker started');
