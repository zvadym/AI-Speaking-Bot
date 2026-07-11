import './instrument-worker.js';
import { registerWorkerHandlers, sendIdiomPracticeMorePhrase } from './jobs.js';
import { registerBotRuntimeWorker } from './bot-runtime/register-worker.js';
import { startWorkerBoss, stopWorkerBoss } from './queue.js';
import { createRuntimeDeps } from './runtime.js';
import { createApiHelpers } from './services/api-helpers.js';
import { createBotAiClient } from './bot-runtime/bot-ai.js';
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
  const runtime = createRuntimeDeps({ apiBoss: boss });
  const helpers = createApiHelpers(runtime);
  const botAi = createBotAiClient({
    apiKey: runtime.env.openaiApiKey,
    model: runtime.env.botRuntimeModel,
    getBotConfig: (botKey) => runtime.botConfigs[botKey] || null
  });
  await registerBotRuntimeWorker(boss, {
    pool: runtime.pool,
    getBotLocale: runtime.getBotLocale,
    telegramClient: runtime.telegramClient,
    webappUrl: runtime.env.webappUrl,
    topicMenuHelpers: helpers,
    getBotConfig: (botKey) => runtime.botConfigs[botKey] || null,
    sendIdiomMore: sendIdiomPracticeMorePhrase,
    ai: botAi
  });
  console.log('Worker started');
} catch (error) {
  console.error('Worker startup failed', error);
  captureException(error, { tags: { phase: 'startup' } });
  await flushSentry(2000);
  process.exit(1);
}
