import type { ConversationTelegramClient } from './conversation.js';
import type { VoiceTelegramClient } from '../ai/graphs/conversation.js';
import { createSettingsHandlers } from './handlers/settings.js';
import type { Pool } from 'pg';
import { parsePreparedUpdateContract, PreparedUpdateContractError } from './contract-validation.js';
import { BOT_UPDATE_QUEUE_NAME, BOT_SETTINGS_QUEUE_NAME } from './contracts.js';
import {
  claimBotUpdateExecution,
  markBotUpdateExecutionFailed,
  markBotUpdateExecutionSucceeded,
  type ExecutionClaimInput,
  type ExecutionClaimResult
} from './execution-repository.js';
import {
  createBotHandlerRegistry,
  normalizeBotRuntimeHandlerError,
  type BotHandlerRegistry
} from './handler-registry.js';
import { createFeedbackHandlers } from './handlers/feedback.js';
import { wakeFeedbackNotifications } from '../feedback-notifications.js';
import {
  createCallbackActionHandlers,
  type IdiomMoreSender
} from './handlers/callback-actions.js';
import { createStaticRouteHandlers } from './handlers/static-routes.js';
import {
  createOnboardingCallbackHandler,
  createOnboardingStartHandler
} from './handlers/onboarding.js';
import { createSupportCallbackHandlers } from './handlers/support-callbacks.js';
import type { SupportTelegramClient } from './support.js';
import type { BotAiClient } from './bot-ai.js';
import {
  createBotPipelineRunner,
  defaultBotPipelineRunner,
  type BotPipelineRunner
} from './pipeline.js';
import { createProgressIndicatorMiddleware } from './progress-middleware.js';
import { createProgressService, type ProgressTelegramClient } from './progress-service.js';
import { createMessagePresentationService, type PresentationClient } from './message-presentation.js';
import { createTextConversationHandler } from './handlers/conversation.js';
import {
  createVoiceConversationHandler,
  createVoiceFeedbackHandler
} from './handlers/voice.js';

interface WorkerJob {
  id: string;
  data?: unknown;
  retryCount?: number;
  retryLimit?: number;
}

interface BossWorker {
  send(
    name: string,
    data: object,
    options: Record<string, unknown>
  ): Promise<string | null>;
  work(
    name: string,
    options: Record<string, unknown>,
    handler: (jobs: WorkerJob[]) => Promise<void>
  ): Promise<unknown>;
}

interface ExecutionRepository {
  claim(pool: Pool, input: ExecutionClaimInput): Promise<ExecutionClaimResult>;
  markSucceeded(pool: Pool, decisionId: string, jobId: string): Promise<void>;
  markFailed(
    pool: Pool,
    decisionId: string,
    jobId: string,
    input: { retryable: boolean; errorCode: string }
  ): Promise<void>;
}

export interface BotRuntimeWorkerDependencies {
  pool: Pool;
  registry: BotHandlerRegistry;
  executionRepository?: ExecutionRepository;
  pipelineRunner?: BotPipelineRunner;
}

export type BotRuntimeJobOutcome =
  | 'succeeded'
  | 'retry_scheduled'
  | 'permanent_failed'
  | 'duplicate_succeeded'
  | 'duplicate_in_progress'
  | 'duplicate_permanent_failed'
  | 'execution_conflict'
  | 'invalid_job'
  | 'retired_job';

const defaultExecutionRepository: ExecutionRepository = {
  claim: claimBotUpdateExecution,
  markSucceeded: markBotUpdateExecutionSucceeded,
  markFailed: markBotUpdateExecutionFailed
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function processBotUpdateJob(
  job: WorkerJob,
  {
    pool,
    registry,
    executionRepository = defaultExecutionRepository,
    pipelineRunner = defaultBotPipelineRunner()
  }: BotRuntimeWorkerDependencies
): Promise<BotRuntimeJobOutcome> {
  const data = asRecord(job.data);
  const handlerVersion = Number(data?.handlerVersion);
  // Pre-rollout jobs must never re-enable removed controls or reset onboarding.
  const retired = new Set(['command.settings','command.level','command.voice','command.lang','command.stats','command.feedback','command.xp','command.progress','callback.level','callback.reply','callback.lang','reply_keyboard.voice_toggle']);
  if (retired.has(String(asRecord(data?.contract)?.route || ''))) return 'retired_job';
  let contract;
  try {
    if (!Number.isInteger(handlerVersion) || handlerVersion <= 0) {
      throw new PreparedUpdateContractError();
    }
    contract = parsePreparedUpdateContract(data?.contract);
  } catch (error) {
    console.error('bot-update-process:invalid-job', {
      jobId: job.id,
      errorCode: error instanceof PreparedUpdateContractError
        ? 'invalid_contract'
        : 'invalid_job'
    });
    return 'invalid_job';
  }

  const handler = registry.get(contract.route);
  if (!handler || handler.version !== handlerVersion) {
    console.error('bot-update-process:handler-mismatch', {
      jobId: job.id,
      decisionId: contract.decisionId,
      botKey: contract.botKey,
      route: contract.route,
      handlerVersion
    });
    return 'invalid_job';
  }

  const claim = await executionRepository.claim(pool, {
    contract,
    handlerVersion,
    jobId: job.id
  });
  if (claim.outcome !== 'claimed') {
    const outcomeByClaim = {
      succeeded: 'duplicate_succeeded',
      in_progress: 'duplicate_in_progress',
      permanent_failed: 'duplicate_permanent_failed',
      conflict: 'execution_conflict'
    } as const;
    const outcome = outcomeByClaim[claim.outcome];
    console.info('bot-update-process:duplicate', {
      jobId: job.id,
      decisionId: contract.decisionId,
      botKey: contract.botKey,
      route: contract.route,
      outcome
    });
    return outcome;
  }

  try {
    const result = await pipelineRunner.execute({
      handler,
      update: contract,
      jobId: job.id,
      attempt: claim.attempts
    });
    await executionRepository.markSucceeded(pool, contract.decisionId, job.id);
    console.info('bot-update-process:succeeded', {
      jobId: job.id,
      decisionId: contract.decisionId,
      botKey: contract.botKey,
      route: contract.route,
      handlerVersion,
      attempt: claim.attempts,
      delivery: result.status
    });
    return 'succeeded';
  } catch (error) {
    const handlerError = normalizeBotRuntimeHandlerError(error);
    const retryLimit = Math.max(1, Number(job.retryLimit || 1));
    const retryCount = Math.max(0, Number(job.retryCount || 0));
    const retryable = handlerError.retryable && retryCount + 1 < retryLimit;
    const errorCode = handlerError.retryable && !retryable
      ? `${handlerError.code}_exhausted`.slice(0, 128)
      : handlerError.code;

    await executionRepository.markFailed(pool, contract.decisionId, job.id, {
      retryable,
      errorCode
    });
    console.warn('bot-update-process:failed', {
      jobId: job.id,
      decisionId: contract.decisionId,
      botKey: contract.botKey,
      route: contract.route,
      handlerVersion,
      attempt: claim.attempts,
      retryable,
      errorCode
    });

    if (retryable) {
      throw handlerError;
    }
    return 'permanent_failed';
  }
}

export async function registerBotRuntimeWorker(
  boss: BossWorker,
  {
    pool,
    getBotLocale,
    telegramClient,
    webappUrl,
    progressEnabledBotKeys,
    reportProgressError = () => {},
    sendIdiomMore,
    ai
  }: {
    pool: Pool;
    getBotLocale(botKey: string): unknown;
    telegramClient: ProgressTelegramClient & SupportTelegramClient & ConversationTelegramClient & VoiceTelegramClient & PresentationClient;
    webappUrl: string;
    progressEnabledBotKeys: ReadonlySet<string>;
    reportProgressError?: (error: unknown, event: string, botKey: string) => void;
    sendIdiomMore: IdiomMoreSender;
    ai: BotAiClient;
  }
): Promise<void> {
  const progressService = createProgressService({ pool, boss, telegramClient });
  const presentation = createMessagePresentationService(pool, telegramClient);
  const pipelineRunner = createBotPipelineRunner([
    createProgressIndicatorMiddleware({
      progressService,
      getBotLocale,
      enabledBotKeys: progressEnabledBotKeys,
      reportError: reportProgressError
    })
  ]);
  const registry = createBotHandlerRegistry([
    ...createStaticRouteHandlers({ pool, getBotLocale, telegramClient }),
    createOnboardingStartHandler({ pool, getBotLocale, telegramClient }),
    createOnboardingCallbackHandler({ pool, getBotLocale, telegramClient }),
    ...createSettingsHandlers({ pool, getBotLocale, telegramClient, webappUrl }),
    ...createFeedbackHandlers({ pool, getBotLocale, telegramClient, wakeNotifications:()=>wakeFeedbackNotifications(boss) }),
    ...createCallbackActionHandlers({
      pool,
      getBotLocale,
        telegramClient,
      sendIdiomMore
    }),
    ...createSupportCallbackHandlers({
      presentation,
      pool,
      getBotLocale,
      telegramClient,
      ai
    }),
    createTextConversationHandler({
      presentation,
      pool,
      getBotLocale,
      telegramClient,
      ai,
      webappUrl
    }),
    createVoiceConversationHandler({
      presentation,
      pool,
      getBotLocale,
      telegramClient,
      ai,
      webappUrl
    }),
    createVoiceFeedbackHandler({
      pool,
      getBotLocale,
      telegramClient,
      wakeNotifications:()=>wakeFeedbackNotifications(boss)
    }),
  ]);

  // Keep the general worker able to drain settings jobs queued before rollout.
  // Independent workers prevent slow AI responses from blocking card controls.
  for (const queue of [BOT_UPDATE_QUEUE_NAME, BOT_SETTINGS_QUEUE_NAME]) {
    await boss.work(
      queue,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: queue === BOT_SETTINGS_QUEUE_NAME ? 0.5 : 1 },
      async (jobs) => {
        for (const job of jobs) {
          await processBotUpdateJob(job, { pool, registry, pipelineRunner });
        }
      }
    );
  }
}
