import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import {
  BotRuntimeHandlerError,
  type BotHandler
} from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import { loadStatsContext, type StatsContext } from '../stats-context.js';
import { buildStatsMessage } from '../stats-message.js';
import {
  classifyTelegramDeliveryError,
  deliverTelegramText,
  type TelegramTextClient,
  type TelegramTextDeliveryRepository
} from '../telegram-text-delivery.js';

export { classifyTelegramDeliveryError } from '../telegram-text-delivery.js';

export const STATS_DELIVERY_STEP_KEY = 'stats-message:v1';

export function createStatsHandler({
  pool,
  getBotLocale,
  telegramClient,
  webappUrl,
  statsContextLoader = loadStatsContext,
  deliveryRepository
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  webappUrl: string;
  statsContextLoader?: (pool: Pool, chatId: number) => Promise<StatsContext>;
  deliveryRepository?: TelegramTextDeliveryRepository;
}): BotHandler<'command.stats'> {
  return {
    route: 'command.stats',
    version: BOT_RUNTIME_HANDLER_VERSIONS['command.stats'],
    async execute(update: PreparedUpdate & { route: 'command.stats' }) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_stats_chat_id', { retryable: false });
      }

      let context: StatsContext;
      try {
        context = await statsContextLoader(pool, chatId);
      } catch (error) {
        throw new BotRuntimeHandlerError('stats_context_unavailable', {
          retryable: true,
          cause: error
        });
      }
      const message = buildStatsMessage({
        context,
        locale: getBotLocale(update.botKey),
        botKey: update.botKey,
        webappUrl
      });

      return deliverTelegramText({
        pool,
        update,
        telegramClient,
        stepKey: STATS_DELIVERY_STEP_KEY,
        text: message.text,
        parseMode: 'HTML',
        replyMarkup: message.replyMarkup,
        deliveryRepository
      });
    }
  };
}
