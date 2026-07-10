import { parsePreparedUpdateContract, PreparedUpdateContractError } from './contract-validation.js';
import {
  BOT_UPDATE_QUEUE_NAME,
  type BotCatalogMeta,
  type PreparedUpdate
} from './contracts.js';
import {
  handlerVersionForRoute,
  isBotRuntimeRouteEnabled,
  type BotRuntimeRouteFlags
} from './route-flags.js';

export type BotUpdateIngestionErrorCode = 'invalid_contract' | 'enqueue_failed';

export class BotUpdateIngestionError extends Error {
  readonly code: BotUpdateIngestionErrorCode;

  constructor(code: BotUpdateIngestionErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'BotUpdateIngestionError';
    this.code = code;
  }
}

interface BossLike {
  send(
    name: string,
    data: object,
    options: Record<string, unknown>
  ): Promise<string | null>;
}

export interface BotUpdateIngestionContext {
  apiBoss: BossLike | null | undefined;
  env: { botRuntimeRouteFlags: BotRuntimeRouteFlags };
  publicBotMetaForKey(botKey: unknown): BotCatalogMeta | null;
}

export type BotUpdateIngestionResult =
  | { accepted: false; error: 'route_not_enabled' }
  | { accepted: true; duplicate: true }
  | { accepted: true; duplicate: false; jobId: string };

export interface BotUpdateJobData {
  contract: PreparedUpdate;
  handlerVersion: number;
}

export async function ingestBotUpdate(
  ctx: BotUpdateIngestionContext,
  rawContract: unknown
): Promise<BotUpdateIngestionResult> {
  let contract: PreparedUpdate;
  try {
    contract = parsePreparedUpdateContract(rawContract);
  } catch (error) {
    if (error instanceof PreparedUpdateContractError) {
      throw new BotUpdateIngestionError('invalid_contract');
    }
    throw error;
  }

  const botMeta = ctx.publicBotMetaForKey(contract.botKey);
  if (!botMeta || botMeta.bot_key !== contract.botKey) {
    throw new BotUpdateIngestionError('invalid_contract');
  }

  if (!isBotRuntimeRouteEnabled(ctx.env.botRuntimeRouteFlags, contract.botKey, contract.route)) {
    return { accepted: false, error: 'route_not_enabled' };
  }

  const handlerVersion = handlerVersionForRoute(contract.route);
  if (!handlerVersion) throw new BotUpdateIngestionError('invalid_contract');
  if (!ctx.apiBoss) throw new BotUpdateIngestionError('enqueue_failed');

  const jobData: BotUpdateJobData = { contract, handlerVersion };
  let jobId: string | null;
  try {
    jobId = await ctx.apiBoss.send(
      BOT_UPDATE_QUEUE_NAME,
      jobData,
      {
        singletonKey: `bot-update:${contract.botKey}:${contract.updateId}`
      }
    );
  } catch (error) {
    throw new BotUpdateIngestionError('enqueue_failed', { cause: error });
  }

  return jobId
    ? { accepted: true, duplicate: false, jobId }
    : { accepted: true, duplicate: true };
}
