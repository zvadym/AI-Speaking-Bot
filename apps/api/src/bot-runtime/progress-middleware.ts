import type { BotPipelineMiddleware } from './pipeline.js';
import type { ProgressService } from './progress-service.js';

type Locale = Record<string, unknown>;

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

export function createProgressIndicatorMiddleware({
  progressService,
  getBotLocale,
  enabledBotKeys,
  reportError = () => {}
}: {
  progressService: ProgressService;
  getBotLocale(botKey: string): unknown;
  enabledBotKeys: ReadonlySet<string>;
  reportError?: (error: unknown, event: string, botKey: string) => void;
}): BotPipelineMiddleware {
  return {
    name: 'progress-indicator',
    async aroundStage(context, stage, next) {
      const update = context.update;
      if (
        stage !== 'conversation.generate' ||
        (update.route !== 'message.text' && update.route !== 'message.voice') ||
        !enabledBotKeys.has(update.botKey)
      ) {
        return next();
      }

      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) return next();
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
        return await next();
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
    }
  };
}
