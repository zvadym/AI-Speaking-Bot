import './instrument-api.js';
import { env } from './env.js';
import { createApp, shutdown } from './app.js';
import { captureException, flushSentry } from './sentry.js';
import { pool } from './db.js';

let app;
try {
  app = await createApp();
  // Open the lock and mutation connections before accepting interactive taps.
  // The pool retains these two clients between requests.
  await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 1')]);
} catch (error) {
  console.error('API startup failed', error);
  captureException(error, { tags: { phase: 'startup' } });
  await flushSentry(2000);
  process.exit(1);
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .then(async () => {
      await flushSentry(2000);
      process.exit(0);
    })
    .catch((error) => {
      console.error('API shutdown failed', error);
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
      console.error('API shutdown failed', error);
      captureException(error, { tags: { phase: 'shutdown', signal: 'SIGTERM' } });
      flushSentry(2000).finally(() => process.exit(1));
    });
});

const server = app.listen(env.port, () => {
  console.log(`API listening on :${env.port}`);
});

server.on('error', (error) => {
  console.error('API server failed', error);
  captureException(error, { tags: { phase: 'listen' } });
  flushSentry(2000).finally(() => process.exit(1));
});
