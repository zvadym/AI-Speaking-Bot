import type { Pool } from 'pg';
import type { PreparedUpdate } from './contracts.js';
import {
  beginBotUpdateDelivery,
  markBotUpdateDeliveryDelivered,
  markBotUpdateDeliveryFailed,
  markBotUpdateDeliveryUnknown
} from './delivery-repository.js';
import { BotRuntimeHandlerError, type BotHandlerOutcome } from './handler-registry.js';
import { classifyTelegramDeliveryError } from './telegram-text-delivery.js';

export interface TelegramVoiceClient {
  sendTelegramVoiceMessage(
    chatId: number,
    buffer: Buffer,
    options: { botKey: string; filename?: string }
  ): Promise<{ message_id?: unknown } | null>;
}

export async function deliverTelegramVoice({
  pool,
  update,
  telegramClient,
  stepKey,
  buffer
}: {
  pool: Pool;
  update: PreparedUpdate;
  telegramClient: TelegramVoiceClient;
  stepKey: string;
  buffer: Buffer;
}): Promise<BotHandlerOutcome> {
  const chatId = update.input.chatId;
  if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new BotRuntimeHandlerError('invalid_telegram_chat_id', { retryable: false });
  }
  let delivery;
  try {
    delivery = await beginBotUpdateDelivery(pool, {
      decisionId: update.decisionId,
      stepKey,
      telegramMethod: 'sendVoice'
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
  try {
    const result = await telegramClient.sendTelegramVoiceMessage(chatId, buffer, {
      botKey: update.botKey,
      filename: 'reply.ogg'
    });
    const rawMessageId = Number(result?.message_id);
    const telegramMessageId = Number.isSafeInteger(rawMessageId) && rawMessageId > 0
      ? rawMessageId
      : null;
    await markBotUpdateDeliveryDelivered(pool, delivery.deliveryId, telegramMessageId);
    return { status: 'delivered', telegramMessageId };
  } catch (error) {
    const classified = classifyTelegramDeliveryError(error);
    try {
      if (classified.kind === 'unknown') {
        await markBotUpdateDeliveryUnknown(pool, delivery.deliveryId, classified);
      } else {
        await markBotUpdateDeliveryFailed(pool, delivery.deliveryId, classified);
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
}
