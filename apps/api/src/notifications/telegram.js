import { createTelegramClient, createTelegramDeliveryState } from '../shared/telegram-delivery.js';
import { env } from '../env.js';
import { pool } from '../db.js';

export const telegramClient = createTelegramClient({
  env,
  fetchImpl: (...args) => fetch(...args)
});

export const { updateUserDeliveryState } = createTelegramDeliveryState({ pool });

export const {
  resolveTelegramBotToken,
  callTelegramApi,
  sendTelegramTextMessage,
  sendTelegramPhotoMessage,
  sendTelegramVideoMessage
} = telegramClient;
