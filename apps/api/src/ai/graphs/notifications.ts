import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { sanitizeErrorText } from '../../shared/telegram-delivery.js';

interface NotificationMessage extends Record<string, unknown> {
  messageText: string;
}

interface MessageValidation {
  ok: boolean;
  error?: string;
  messageText?: string;
}

type FallbackMessage = Partial<NotificationMessage> & { ok: boolean; error?: string | null };

function generationError(error: unknown): string {
  const detail = error && typeof error === 'object' ? error as { detail?: unknown; message?: unknown } : null;
  // Keep diagnostics as text, never an SDK error/request object or credentials.
  const text = String(detail?.detail || detail?.message || error || 'llm_generation_failed')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]');
  return sanitizeErrorText(text) || 'llm_generation_failed';
}

// Used by the two existing AI notifications: weekly digest and winback.
// Eligibility, schedules, dispatch attempts, reporting and sends remain in jobs.
export function createNotificationGraph<Context>({ generate, validate, fallback }: {
  generate(context: Context, taskType: string): Promise<NotificationMessage>;
  validate(messageText: string, context: Context): MessageValidation;
  fallback(context: Context, taskType: string): FallbackMessage;
}) {
  const NotificationState = Annotation.Root({
    usesLlm: Annotation<boolean>(),
    generation: Annotation<NotificationMessage | null>(),
    generationError: Annotation<string | null>(),
    fallbackError: Annotation<string | null>(),
    failure: Annotation<'build' | 'validation' | null>()
  });
  // Existing notification context includes Dates. It is invocation context,
  // while state contains only the generated message and sanitized diagnostics.
  const NotificationContext = Annotation.Root({
    notification: Annotation<Context>(),
    taskType: Annotation<string>()
  });
  return new StateGraph(NotificationState, { context: NotificationContext })
    .addNode('generate', async (_state, runtime) => {
      const { notification, taskType } = runtime.context!;
      try {
        return { generation: await generate(notification, taskType) };
      } catch (error) {
        return { generation: null, generationError: generationError(error) };
      }
    })
    .addNode('validateGenerated', ({ generation }, runtime) => {
      const validation = validate(generation!.messageText, runtime.context!.notification);
      return validation.ok
        ? { generation: { ...generation!, messageText: validation.messageText! } }
        : { generation: null, generationError: validation.error || 'llm_generation_failed' };
    })
    .addNode('fallback', (_state, runtime) => {
      const result = fallback(runtime.context!.notification, runtime.context!.taskType);
      return result.ok
        ? { generation: result as NotificationMessage }
        : { generation: null, fallbackError: result.error || null, failure: 'build' as const };
    })
    .addNode('validateFallback', ({ generation }, runtime) => {
      const validation = validate(generation!.messageText, runtime.context!.notification);
      return validation.ok
        ? { generation: { ...generation!, messageText: validation.messageText! } }
        : { generation: null, fallbackError: validation.error || null, failure: 'validation' as const };
    })
    .addConditionalEdges(START, ({ usesLlm }) => usesLlm ? 'generate' : 'fallback', ['generate', 'fallback'])
    .addConditionalEdges('generate', ({ generation }) => generation ? 'validateGenerated' : 'fallback', ['validateGenerated', 'fallback'])
    .addConditionalEdges('validateGenerated', ({ generation }) => generation ? END : 'fallback', [END, 'fallback'])
    .addConditionalEdges('fallback', ({ generation }) => generation ? 'validateFallback' : END, ['validateFallback', END])
    .addEdge('validateFallback', END)
    .compile();
}
