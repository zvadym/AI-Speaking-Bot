import type { Pool } from 'pg';
import { parsePreparedUpdateContract, PreparedUpdateContractError } from './contract-validation.js';
import { BOT_UPDATE_QUEUE_NAME } from './contracts.js';
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
import {
  createPreferenceHandlers,
  type PreferenceTelegramClient
} from './handlers/preferences.js';
import { createFeedbackHandlers } from './handlers/feedback.js';
import { createStaticRouteHandlers } from './handlers/static-routes.js';
import { createStatsHandler } from './handlers/stats.js';
import {
  createTopicMenuHandler,
  type TopicMenuHelpers
} from './handlers/topic-menu.js';
import { createXpHandler } from './handlers/xp.js';

interface WorkerJob {
  id: string;
  data?: unknown;
  retryCount?: number;
  retryLimit?: number;
}

interface BossWorker {
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
}

export type BotRuntimeJobOutcome =
  | 'succeeded'
  | 'retry_scheduled'
  | 'permanent_failed'
  | 'duplicate_succeeded'
  | 'duplicate_in_progress'
  | 'duplicate_permanent_failed'
  | 'execution_conflict'
  | 'invalid_job';

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
    executionRepository = defaultExecutionRepository
  }: BotRuntimeWorkerDependencies
): Promise<BotRuntimeJobOutcome> {
  const data = asRecord(job.data);
  const handlerVersion = Number(data?.handlerVersion);
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
    const result = await handler.execute(contract);
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
    topicMenuHelpers
  }: {
    pool: Pool;
    getBotLocale(botKey: string): unknown;
    telegramClient: PreferenceTelegramClient;
    webappUrl: string;
    topicMenuHelpers: TopicMenuHelpers;
  }
): Promise<void> {
  const registry = createBotHandlerRegistry([
    ...createStaticRouteHandlers({ pool, getBotLocale, telegramClient }),
    ...createPreferenceHandlers({ pool, getBotLocale, telegramClient }),
    ...createFeedbackHandlers({ pool, getBotLocale, telegramClient }),
    createStatsHandler({ pool, getBotLocale, telegramClient, webappUrl }),
    createXpHandler({ pool, getBotLocale, telegramClient }),
    createTopicMenuHandler({
      pool,
      getBotLocale,
      telegramClient,
      helpers: topicMenuHelpers
    })
  ]);

  await boss.work(
    BOT_UPDATE_QUEUE_NAME,
    { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await processBotUpdateJob(job, { pool, registry });
      }
    }
  );
}
