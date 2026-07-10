import type { PreparedUpdate, Route } from './contracts.js';

export interface BotHandlerOutcome {
  status: 'delivered' | 'duplicate';
  telegramMessageId?: number | null;
}

export interface BotHandler<R extends Route = Route> {
  route: R;
  version: number;
  execute(update: PreparedUpdate & { route: R }): Promise<BotHandlerOutcome>;
}

export class BotRuntimeHandlerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, { retryable, cause }: { retryable: boolean; cause?: unknown }) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'BotRuntimeHandlerError';
    this.code = String(code || 'handler_failed').slice(0, 128);
    this.retryable = retryable;
  }
}

export function normalizeBotRuntimeHandlerError(error: unknown): BotRuntimeHandlerError {
  if (error instanceof BotRuntimeHandlerError) return error;
  return new BotRuntimeHandlerError('unexpected_handler_error', {
    retryable: true,
    cause: error
  });
}

export interface BotHandlerRegistry {
  get(route: Route): BotHandler | null;
}

export function createBotHandlerRegistry(handlers: BotHandler[]): BotHandlerRegistry {
  const byRoute = new Map<Route, BotHandler>();
  for (const handler of handlers) {
    if (!Number.isInteger(handler.version) || handler.version <= 0) {
      throw new Error(`Invalid handler version for ${handler.route}`);
    }
    if (byRoute.has(handler.route)) throw new Error(`Duplicate handler for ${handler.route}`);
    byRoute.set(handler.route, handler);
  }
  return {
    get(route) {
      return byRoute.get(route) || null;
    }
  };
}
