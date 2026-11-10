import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { buildPersistentReplyMarkup } from '../keyboard-state.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import { deliverTelegramText, type TelegramTextClient } from '../telegram-text-delivery.js';

export function buildRetiredCommandMessage(update: PreparedUpdate, localeRaw: unknown) {
  const locale = localeRaw && typeof localeRaw === 'object'
    ? localeRaw as Record<string, unknown> : {};
  return {
    text: String(locale.msg_error_command || 'I do not know that command yet.'),
    replyMarkup: buildPersistentReplyMarkup(update.context.keyboard)
  };
}

export function createRetiredCommandHandlers({ pool, getBotLocale, telegramClient }: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
}): BotHandler[] {
  // Keep the old route/version/delivery key so pending v1 jobs retain their
  // identity and cannot resend an already delivered message on retry.
  return (['command.progress', 'command.xp'] as const).map((route) => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate) {
      if (update.input.chatId === null || !Number.isSafeInteger(update.input.chatId) || update.input.chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_retired_command_chat_id', { retryable: false });
      }
      const message = buildRetiredCommandMessage(update, getBotLocale(update.botKey));
      return deliverTelegramText({
        pool, update, telegramClient,
        stepKey: route === 'command.xp' ? 'xp-message:v1' : 'progress-message:v1',
        text: message.text,
        replyMarkup: message.replyMarkup
      });
    }
  }));
}
