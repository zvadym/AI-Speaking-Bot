import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;
type CallbackRoute =
  | 'callback.busy'
  | 'callback.idiom_more'
  | 'callback.unknown';

interface CallbackTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(
    callbackQueryId: string,
    text?: string,
    options?: { botKey?: string | null; showAlert?: boolean }
  ): Promise<unknown>;
}

export interface IdiomMoreResult {
  callbackText?: string;
}

export interface IdiomMoreSender {
  (input: {
    chatId: number;
    botKey: string;
    scheduleKey: string;
    callbackQueryId: string;
    sourceMessageId: number | null;
  }): Promise<IdiomMoreResult>;
}

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '').trim();
  return value || fallback;
}

async function answerCallback(
  telegramClient: CallbackTelegramClient,
  update: PreparedUpdate,
  text: string
): Promise<void> {
  const callbackId = update.input.callbackQuery?.id;
  if (!callbackId) return;
  try {
    await telegramClient.answerTelegramCallbackQuery(callbackId, text, {
      botKey: update.botKey
    });
  } catch {
    // Callback answers are ephemeral and must not retry an already durable action.
  }
}

export function createCallbackActionHandlers({
  pool,
  getBotLocale,
  telegramClient,
  sendIdiomMore,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: CallbackTelegramClient;
  sendIdiomMore: IdiomMoreSender;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler[] {
  const routes: CallbackRoute[] = [
    'callback.busy',
    'callback.idiom_more',
    'callback.unknown'
  ];

  return routes.map((route): BotHandler => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate & { route: typeof route }) {
      const callback = update.input.callbackQuery;
      const chatId = update.input.chatId;
      if (!callback || chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_callback_update', { retryable: false });
      }
      const locale = localeRecord(getBotLocale(update.botKey));

      if (route === 'callback.busy') {
        await answerCallback(
          telegramClient,
          update,
          localeText(locale, 'callback_translating', 'Still preparing this result...')
        );
        return { status: 'noop' };
      }

      if (route === 'callback.idiom_more') {
        let result: IdiomMoreResult;
        try {
          result = await sendIdiomMore({
            chatId,
            botKey: update.botKey,
            scheduleKey: String(update.routingFacts.callback?.payload || '').trim(),
            callbackQueryId: callback.id,
            sourceMessageId: callback.messageId
          });
        } catch (error) {
          throw new BotRuntimeHandlerError('idiom_more_failed', {
            retryable: true,
            cause: error
          });
        }
        await answerCallback(telegramClient, update, String(result.callbackText || ''));
        return { status: 'noop' };
      }

      if (route === 'callback.unknown') {
        await answerCallback(
          telegramClient,
          update,
          localeText(locale, 'callback_expired', 'This button has expired.')
        );
        return { status: 'noop' };
      }

      return { status: 'noop' };
    }
  }));
}
