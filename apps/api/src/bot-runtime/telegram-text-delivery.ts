import type { Pool } from 'pg';
import type { PreparedUpdate } from './contracts.js';
import {
  beginBotUpdateDelivery,
  markBotUpdateDeliveryDelivered,
  markBotUpdateDeliveryFailed,
  markBotUpdateDeliveryUnknown
} from './delivery-repository.js';
import {
  BotRuntimeHandlerError,
  type BotHandlerOutcome
} from './handler-registry.js';

export interface TelegramTextClient {
  sendTelegramTextMessage(
    chatId: number,
    text: string,
    options: {
      botKey: string;
      parseMode?: 'HTML' | null;
      replyMarkup?: object | null;
    }
  ): Promise<{ message_id?: unknown } | null>;
}

export interface TelegramTextDeliveryRepository {
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

const defaultDeliveryRepository: TelegramTextDeliveryRepository = {
  begin: beginBotUpdateDelivery,
  markDelivered: markBotUpdateDeliveryDelivered,
  markFailed: markBotUpdateDeliveryFailed,
  markUnknown: markBotUpdateDeliveryUnknown
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

export async function deliverTelegramText({
  pool,
  update,
  telegramClient,
  stepKey,
  text,
  parseMode = null,
  replyMarkup = null,
  telegramMethod = 'sendMessage',
  deliveryRepository = defaultDeliveryRepository
}: {
  pool: Pool;
  update: PreparedUpdate;
  telegramClient: TelegramTextClient;
  stepKey: string;
  text: string;
  parseMode?: 'HTML' | null;
  replyMarkup?: object | null;
  telegramMethod?: 'sendMessage' | 'sendRichMessage' | 'sendWidget';
  deliveryRepository?: TelegramTextDeliveryRepository;
}): Promise<BotHandlerOutcome> {
  const chatId = update.input.chatId;
  if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new BotRuntimeHandlerError('invalid_telegram_chat_id', { retryable: false });
  }

  let delivery;
  try {
    delivery = await deliveryRepository.begin(pool, {
      decisionId: update.decisionId,
      stepKey,
      telegramMethod
    });
  } catch (error) {
    throw new BotRuntimeHandlerError('delivery_state_unavailable', {
      retryable: true,
      cause: error
    });
  }

  if (delivery.action === 'delivered') {
    return { status: 'duplicate', telegramMessageId: delivery.telegramMessageId };
  }
  if (delivery.action === 'unknown') {
    throw new BotRuntimeHandlerError(
      delivery.errorCode || 'telegram_delivery_unknown',
      { retryable: false }
    );
  }

  let telegramResult: { message_id?: unknown } | null;
  try {
    telegramResult = await telegramClient.sendTelegramTextMessage(chatId, text, {
      botKey: update.botKey,
      parseMode,
      replyMarkup
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
      // The next attempt converts an unfinished pending delivery to unknown.
    }
    throw new BotRuntimeHandlerError('telegram_delivery_commit_unknown', {
      retryable: false,
      cause: error
    });
  }

  return { status: 'delivered', telegramMessageId };
}
