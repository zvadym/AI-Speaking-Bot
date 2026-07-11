import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';
import { loadXpContext, type XpContext } from '../xp-context.js';
import { buildXpMessage } from '../xp-message.js';

export const XP_DELIVERY_STEP_KEY = 'xp-message:v1';

export function createXpHandler({
  pool,
  getBotLocale,
  telegramClient,
  xpContextLoader = loadXpContext
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  xpContextLoader?: (pool: Pool, chatId: number, botKey: string) => Promise<XpContext>;
}): BotHandler<'command.xp'> {
  return {
    route: 'command.xp',
    version: BOT_RUNTIME_HANDLER_VERSIONS['command.xp'],
    async execute(update: PreparedUpdate & { route: 'command.xp' }) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_xp_chat_id', { retryable: false });
      }

      let context: XpContext;
      try {
        context = await xpContextLoader(pool, chatId, update.botKey);
      } catch (error) {
        throw new BotRuntimeHandlerError('xp_context_unavailable', {
          retryable: true,
          cause: error
        });
      }
      const message = buildXpMessage({
        context,
        locale: getBotLocale(update.botKey),
        keyboard: update.context.keyboard
      });

      return deliverTelegramText({
        pool,
        update,
        telegramClient,
        stepKey: XP_DELIVERY_STEP_KEY,
        text: message.text,
        parseMode: 'HTML',
        replyMarkup: message.replyMarkup
      });
    }
  };
}
