import './instrument-worker.js';
import { registerWorkerHandlers } from './jobs.js';
import { sendIdiomPracticeMorePhrase } from './idioms/practice.js';
import { registerBotRuntimeWorker } from './bot-runtime/register-worker.js';
import { startWorkerBoss, stopWorkerBoss } from './queue.js';
import { createRuntimeDeps } from './runtime.js';
import { registerFeedbackNotifications } from './feedback/notifications.js';
import { createBotAiClient } from './ai/client.js';
import { createLlmCallRecorder } from './ai/llm-telemetry.js';
import { createVocabularyAi } from './vocabulary/ai.js';
import { registerVocabularyAnalysis } from './vocabulary/worker.js';
import { isBotRuntimeRouteEnabled } from './bot-runtime/route-flags.js';
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
  const recordLlmCall = createLlmCallRecorder(runtime.pool);
  const botAi = createBotAiClient({
    apiKey: runtime.env.openaiApiKey,
    elevenlabsApiKey: runtime.env.elevenlabsApiKey,
    model: runtime.env.botRuntimeModel,
    conversationReasoningEffort: runtime.env.botRuntimeReasoningEffort,
    supportModel: runtime.env.botSupportModel,
    supportReasoningEffort: runtime.env.botSupportReasoningEffort,
    transcriptionModel: runtime.env.botTranscriptionModel,
    ttsModel: runtime.env.botTtsModel,
    recordLlmCall,
    getModelPolicy: (botKey) => runtime.env.botModelPolicyOverrides[botKey],
    getBotConfig: (botKey) => runtime.botConfigs[botKey] || null
  });
  await registerBotRuntimeWorker(boss, {
    vocabularyAddEnabled: (botKey) => isBotRuntimeRouteEnabled(runtime.env.botRuntimeRouteFlags, botKey, 'callback.vocab_add'),
    pool: runtime.pool,
    getBotLocale: runtime.getBotLocale,
    telegramClient: runtime.telegramClient,
    webappUrl: runtime.env.webappUrl,
    progressEnabledBotKeys: runtime.env.botProgressEnabledBotKeys,
    reportProgressError: (error, event, botKey) => captureException(error, {
      tags: { subsystem: 'progress-indicator', event, bot_key: botKey }
    }),
    sendIdiomMore: sendIdiomPracticeMorePhrase,
    ai: botAi
  });
  await registerFeedbackNotifications(boss,{pool:runtime.pool,webhookUrl:runtime.env.discordEventsWebhookUrl,telegramClient:runtime.telegramClient,ai:botAi,botMetaForKey:runtime.publicBotMetaForKey});
  await registerVocabularyAnalysis(boss, {pool:runtime.pool, ai:createVocabularyAi({apiKey:runtime.env.openaiApiKey,recordLlmCall})});
  console.log('Worker started');
} catch (error) {
  console.error('Worker startup failed', error);
  captureException(error, { tags: { phase: 'startup' } });
  await flushSentry(2000);
  process.exit(1);
}
