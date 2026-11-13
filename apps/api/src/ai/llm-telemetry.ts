import type { Pool } from 'pg';

type UnknownRecord = Record<string, unknown>;

export interface LlmTraceContext {
  decisionId?: string | null;
  chatId?: number | null;
  botKey: string;
  route?: string | null;
}

export interface LlmUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface LlmCallEvent extends LlmUsage {
  trace: LlmTraceContext;
  operation: string;
  model: string;
  reasoningEffort: string | null;
  durationMs: number;
  success: boolean;
  errorCode: string | null;
}

export type LlmCallRecorder = (event: LlmCallEvent) => Promise<void>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function tokenCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function extractLlmUsage(response: unknown): LlmUsage {
  const usage = asRecord(asRecord(response).usage);
  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  return {
    inputTokens: tokenCount(usage.input_tokens ?? usage.prompt_tokens),
    cachedInputTokens: tokenCount(inputDetails.cached_tokens),
    outputTokens: tokenCount(usage.output_tokens ?? usage.completion_tokens),
    reasoningTokens: tokenCount(outputDetails.reasoning_tokens),
    totalTokens: tokenCount(usage.total_tokens)
  };
}

export function classifyLlmError(error: unknown): string {
  const value = asRecord(error);
  const raw = value.code || value.type || value.status || value.name || 'llm_call_failed';
  const normalized = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '_')
    .slice(0, 128);
  return normalized || 'llm_call_failed';
}

export function createLlmCallRecorder(pool: Pool): LlmCallRecorder {
  return async (event) => {
    try {
      await pool.query(
        `INSERT INTO llm_call_events (
           decision_id, chat_id, bot_key, route, operation, model,
           reasoning_effort, duration_ms, success, error_code,
           input_tokens, cached_input_tokens, output_tokens,
           reasoning_tokens, total_tokens, occurred_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13,
           $14, $15, NOW()
         )`,
        [
          String(event.trace.decisionId || '').trim().slice(0, 128) || null,
          Number.isSafeInteger(event.trace.chatId) ? event.trace.chatId : null,
          String(event.trace.botKey || '').trim().toLowerCase().slice(0, 32),
          String(event.trace.route || '').trim().slice(0, 64) || null,
          String(event.operation || '').trim().slice(0, 64),
          String(event.model || '').trim().slice(0, 128),
          String(event.reasoningEffort || '').trim().slice(0, 16) || null,
          Math.max(0, Math.round(event.durationMs)),
          event.success,
          event.errorCode,
          event.inputTokens,
          event.cachedInputTokens,
          event.outputTokens,
          event.reasoningTokens,
          event.totalTokens
        ]
      );
    } catch (error) {
      console.warn('llm-telemetry:write-failed', {
        botKey: event.trace.botKey,
        operation: event.operation,
        model: event.model,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

export async function observeLlmCall<T>({
  trace,
  operation,
  model,
  reasoningEffort = null,
  record,
  call,
  now = () => performance.now()
}: {
  trace: LlmTraceContext;
  operation: string;
  model: string;
  reasoningEffort?: string | null;
  record?: LlmCallRecorder;
  call: () => Promise<T>;
  now?: () => number;
}): Promise<T> {
  const startedAt = now();
  const recordQuietly = async (event: LlmCallEvent): Promise<void> => {
    if (!record) return;
    try {
      await record(event);
    } catch (error) {
      console.warn('llm-telemetry:recorder-failed', {
        botKey: trace.botKey,
        operation,
        model,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
  try {
    const result = await call();
    await recordQuietly({
      trace,
      operation,
      model,
      reasoningEffort,
      durationMs: Math.max(0, now() - startedAt),
      success: true,
      errorCode: null,
      ...extractLlmUsage(result)
    });
    return result;
  } catch (error) {
    await recordQuietly({
      trace,
      operation,
      model,
      reasoningEffort,
      durationMs: Math.max(0, now() - startedAt),
      success: false,
      errorCode: classifyLlmError(error),
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null
    });
    throw error;
  }
}
