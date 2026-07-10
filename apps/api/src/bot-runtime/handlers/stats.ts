import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import {
  beginBotUpdateDelivery,
  markBotUpdateDeliveryDelivered,
  markBotUpdateDeliveryFailed,
  markBotUpdateDeliveryUnknown
} from '../delivery-repository.js';
import {
  BotRuntimeHandlerError,
  type BotHandler
} from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import { loadStatsContext, type StatsContext } from '../stats-context.js';
import { buildStatsMessage } from '../stats-message.js';

export const STATS_DELIVERY_STEP_KEY = 'stats-message:v1';

interface TelegramClient {
  sendTelegramTextMessage(
    chatId: number,
    text: string,
    options: {
      botKey: string;
      parseMode: 'HTML';
      replyMarkup: object;
    }
  ): Promise<{ message_id?: unknown } | null>;
}

interface DeliveryRepository {
  begin: typeof beginBotUpdateDelivery;
  markDelivered: typeof markBotUpdateDeliveryDelivered;
  markFailed: typeof markBotUpdateDeliveryFailed;
  markUnknown: typeof markBotUpdateDeliveryUnknown;
}

export type TelegramDeliveryErrorClassification = {
  kind: 'retryable' | 'permanent' | 'unknown';
  errorCode: string;
  errorDetail: string;
};

export function classifyTelegramDeliveryError(
  error: unknown
): TelegramDeliveryErrorClassification {
  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    telegramStatus?: unknown;
    telegramDescription?: unknown;
  };
  const status = Number(value?.telegramStatus);
  const code = String(value?.code || '').trim().toLowerCase();
  const detail = String(value?.telegramDescription || value?.message || error || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const searchable = `${String(value?.name || '').toLowerCase()} ${code} ${detail.toLowerCase()}`;

  if (
    searchable.includes('timeout') ||
    searchable.includes('timed out') ||
    code === 'etimedout' ||
    code === 'econnreset'
  ) {
    return { kind: 'unknown', errorCode: 'telegram_delivery_timeout', errorDetail: detail };
  }
  if (code === 'missing_telegram_bot_token') {
    return { kind: 'permanent', errorCode: code, errorDetail: detail };
  }
  if (Number.isFinite(status) && status === 429) {
    return { kind: 'retryable', errorCode: 'telegram_rate_limited', errorDetail: detail };
  }
  if (Number.isFinite(status) && status >= 500) {
    return { kind: 'retryable', errorCode: 'telegram_server_error', errorDetail: detail };
  }
  if (Number.isFinite(status) && status >= 400) {
    return { kind: 'permanent', errorCode: `telegram_http_${status}`, errorDetail: detail };
  }
  return {
    kind: 'unknown',
    errorCode: 'telegram_delivery_ambiguous',
    errorDetail: detail
  };
}

export function createStatsHandler({
  pool,
  getBotLocale,
  telegramClient,
  webappUrl,
  statsContextLoader = loadStatsContext,
  deliveryRepository = {
    begin: beginBotUpdateDelivery,
    markDelivered: markBotUpdateDeliveryDelivered,
    markFailed: markBotUpdateDeliveryFailed,
    markUnknown: markBotUpdateDeliveryUnknown
  }
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramClient;
  webappUrl: string;
  statsContextLoader?: (pool: Pool, chatId: number) => Promise<StatsContext>;
  deliveryRepository?: DeliveryRepository;
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

      let delivery;
      try {
        delivery = await deliveryRepository.begin(pool, {
          decisionId: update.decisionId,
          stepKey: STATS_DELIVERY_STEP_KEY,
          telegramMethod: 'sendMessage'
        });
      } catch (error) {
        throw new BotRuntimeHandlerError('delivery_state_unavailable', {
          retryable: true,
          cause: error
        });
      }

      if (delivery.action === 'delivered') {
        return {
          status: 'duplicate',
          telegramMessageId: delivery.telegramMessageId
        };
      }
      if (delivery.action === 'unknown') {
        throw new BotRuntimeHandlerError(
          delivery.errorCode || 'telegram_delivery_unknown',
          { retryable: false }
        );
      }

      let telegramResult: { message_id?: unknown } | null;
      try {
        telegramResult = await telegramClient.sendTelegramTextMessage(chatId, message.text, {
          botKey: update.botKey,
          parseMode: 'HTML',
          replyMarkup: message.replyMarkup
        });
      } catch (error) {
        const classified = classifyTelegramDeliveryError(error);
        try {
          if (classified.kind === 'unknown') {
            await deliveryRepository.markUnknown(pool, delivery.deliveryId, classified);
          } else {
            await deliveryRepository.markFailed(pool, delivery.deliveryId, classified);
          }
        } catch (stateError) {
          throw new BotRuntimeHandlerError('delivery_state_unavailable', {
            retryable: true,
            cause: stateError
          });
        }
        throw new BotRuntimeHandlerError(classified.errorCode, {
          retryable: classified.kind === 'retryable',
          cause: error
        });
      }

      const rawMessageId = Number(telegramResult?.message_id);
      const telegramMessageId = Number.isSafeInteger(rawMessageId) && rawMessageId > 0
        ? rawMessageId
        : null;
      try {
        await deliveryRepository.markDelivered(pool, delivery.deliveryId, telegramMessageId);
      } catch (error) {
        try {
          await deliveryRepository.markUnknown(pool, delivery.deliveryId, {
            errorCode: 'telegram_delivery_commit_unknown',
            errorDetail: error
          });
        } catch {
          // A retry will convert the unfinished pending attempt to unknown.
        }
        throw new BotRuntimeHandlerError('telegram_delivery_commit_unknown', {
          retryable: false,
          cause: error
        });
      }

      return { status: 'delivered', telegramMessageId };
    }
  };
}
