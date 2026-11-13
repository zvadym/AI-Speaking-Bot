import type { PreparedUpdate } from '../contracts.js';
import type { ProgressService } from './progress-service.js';

type Locale = Record<string, unknown>;

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

export type ConversationProgress = <T>(update: PreparedUpdate, operation: () => Promise<T>) => Promise<T>;

export function createConversationProgress({
  progressService,
  getBotLocale,
  enabledBotKeys,
  reportError = () => {}
}: {
  progressService: ProgressService;
  getBotLocale(botKey: string): unknown;
  enabledBotKeys: ReadonlySet<string>;
  reportError?: (error: unknown, event: string, botKey: string) => void;
}): ConversationProgress {
  return async (update, operation) => {
    if (
      (update.route !== 'message.text' && update.route !== 'message.voice') ||
      !enabledBotKeys.has(update.botKey)
    ) {
      return operation();
    }

    const chatId = update.input.chatId;
    if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) return operation();
    const locale = localeRecord(getBotLocale(update.botKey));
    const waitingText = locale.waiting_text;
    const messages = locale.loader_messages;
    let sessionId = '';
    try {
      const session = await progressService.start({
        chatId,
        botKey: update.botKey,
        waitingText,
        messages
      });
      sessionId = session.sessionId;
    } catch (error) {
      console.warn('progress-middleware:start-failed', {
        decisionId: update.decisionId,
        botKey: update.botKey,
        route: update.route,
        error: error instanceof Error ? error.message : String(error)
      });
      reportError(error, 'start', update.botKey);
    }

    try {
      return await operation();
    } finally {
      if (sessionId) {
        try {
          await progressService.stop({ chatId, botKey: update.botKey, sessionId });
        } catch (error) {
          console.warn('progress-middleware:stop-failed', {
            decisionId: update.decisionId,
            botKey: update.botKey,
            route: update.route,
            error: error instanceof Error ? error.message : String(error)
          });
          reportError(error, 'stop', update.botKey);
        }
      }
    }
  };
}
