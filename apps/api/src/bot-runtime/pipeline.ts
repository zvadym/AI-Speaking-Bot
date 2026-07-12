import type { PreparedUpdate } from './contracts.js';
import type {
  BotHandler,
  BotHandlerOutcome
} from './handler-registry.js';

export interface BotPipelineContext {
  readonly update: PreparedUpdate;
  readonly handlerVersion: number;
  readonly jobId: string;
  readonly attempt: number;
  readonly state: Map<string, unknown>;
  runStage<T>(stage: string, operation: () => Promise<T>): Promise<T>;
}

export interface BotPipelineMiddleware {
  readonly name: string;
  execute?(
    context: BotPipelineContext,
    next: () => Promise<BotHandlerOutcome>
  ): Promise<BotHandlerOutcome>;
  aroundStage?<T>(
    context: BotPipelineContext,
    stage: string,
    next: () => Promise<T>
  ): Promise<T>;
}

export interface BotPipelineExecutionInput {
  handler: BotHandler;
  update: PreparedUpdate;
  jobId: string;
  attempt: number;
}

export interface BotPipelineRunner {
  execute(input: BotPipelineExecutionInput): Promise<BotHandlerOutcome>;
}

function normalizedMiddlewareName(value: unknown): string {
  return String(value || '').trim();
}

function validateMiddlewares(middlewares: readonly BotPipelineMiddleware[]): void {
  const names = new Set<string>();
  for (const middleware of middlewares) {
    const name = normalizedMiddlewareName(middleware.name);
    if (!name) throw new Error('pipeline_middleware_name_missing');
    if (names.has(name)) throw new Error(`pipeline_middleware_duplicate:${name}`);
    names.add(name);
  }
}

async function runStageMiddlewares<T>(
  middlewares: readonly BotPipelineMiddleware[],
  context: BotPipelineContext,
  stage: string,
  operation: () => Promise<T>
): Promise<T> {
  let activeIndex = -1;
  const dispatch = async (index: number): Promise<T> => {
    if (index <= activeIndex) throw new Error('pipeline_stage_next_called_multiple_times');
    activeIndex = index;
    const middleware = middlewares[index];
    if (!middleware) return operation();
    if (!middleware.aroundStage) return dispatch(index + 1);
    return middleware.aroundStage(context, stage, () => dispatch(index + 1));
  };
  return dispatch(0);
}

export function createBotPipelineRunner(
  middlewares: readonly BotPipelineMiddleware[] = []
): BotPipelineRunner {
  const configured = [...middlewares];
  validateMiddlewares(configured);

  return {
    async execute({ handler, update, jobId, attempt }) {
      const state = new Map<string, unknown>();
      let context: BotPipelineContext;
      context = Object.freeze({
        update,
        handlerVersion: handler.version,
        jobId,
        attempt,
        state,
        runStage<T>(stage: string, operation: () => Promise<T>) {
          const normalizedStage = String(stage || '').trim();
          if (!normalizedStage) return Promise.reject(new Error('pipeline_stage_name_missing'));
          return runStageMiddlewares(configured, context, normalizedStage, operation);
        }
      });

      let activeIndex = -1;
      const dispatch = async (index: number): Promise<BotHandlerOutcome> => {
        if (index <= activeIndex) throw new Error('pipeline_next_called_multiple_times');
        activeIndex = index;
        const middleware = configured[index];
        if (!middleware) return handler.execute(update, context);
        if (!middleware.execute) return dispatch(index + 1);
        return middleware.execute(context, () => dispatch(index + 1));
      };

      return dispatch(0);
    }
  };
}

const emptyPipelineRunner = createBotPipelineRunner();

export function defaultBotPipelineRunner(): BotPipelineRunner {
  return emptyPipelineRunner;
}

export async function runBotPipelineStage<T>(
  context: BotPipelineContext | undefined,
  stage: string,
  operation: () => Promise<T>
): Promise<T> {
  return context ? context.runStage(stage, operation) : operation();
}
