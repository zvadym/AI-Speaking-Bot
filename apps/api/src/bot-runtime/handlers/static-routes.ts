import type { Pool } from 'pg';
import type { PreparedUpdate, Route } from '../contracts.js';
import { buildPersistentReplyMarkup } from '../keyboard-state.js';
import type { BotHandler } from '../handler-registry.js';
import {
  BOT_RUNTIME_HANDLER_VERSIONS,
  type ImplementedBotRuntimeRoute
} from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../delivery/telegram-text-delivery.js';

type Locale = Record<string, unknown>;

interface StaticMessage {
  text: string;
  parseMode?: 'HTML' | null;
  replyMarkup?: object | null;
}

function localeRecord(value: unknown): Locale {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Locale
    : {};
}

function localeText(locale: Locale, key: string, fallback: string): string {
  const value = String(locale[key] || '');
  return value.trim() ? value : fallback;
}

export function buildStaticRouteMessage(
  route: ImplementedBotRuntimeRoute,
  update: PreparedUpdate,
  localeRaw: unknown
): StaticMessage | null {
  const locale = localeRecord(localeRaw);
  switch (route) {
    case 'ignore':
      return null;
    case 'guard.private_only':
      return { text: localeText(locale, 'msg_private_only', 'Please use this bot in a private chat.') };
    case 'guard.bot_sender':
      return { text: localeText(locale, 'msg_to_bot', '🤖→🤖 Please send a message from a user account.') };
    case 'command.start':
      return {
        text: localeText(locale, 'hi_message_text', 'Hi! Send a short voice or text message to start.'),
        replyMarkup: {
          inline_keyboard: [[{
            text: localeText(locale, 'onboarding_btn_show_example', 'Show example'),
            callback_data: 'onb:example'
          }]]
        }
      };
    case 'command.unknown':
      return {
        text: localeText(locale, 'msg_error_command', 'I do not know that command yet.'),
        replyMarkup: buildPersistentReplyMarkup(update.context.keyboard)
      };
    case 'message.unsupported':
      return {
        text: localeText(locale, 'msg_needs_text_or_voice', 'Please send a text or voice message.')
      };
    default:
      return null;
  }
}

function createStaticRouteHandler<R extends ImplementedBotRuntimeRoute>({
  route,
  pool,
  getBotLocale,
  telegramClient
}: {
  route: R;
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
}): BotHandler<R> {
  return {
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update: PreparedUpdate & { route: R }) {
      const message = buildStaticRouteMessage(route, update, getBotLocale(update.botKey));
      if (!message) return { status: 'noop' };

      return deliverTelegramText({
        pool,
        update,
        telegramClient,
        stepKey: `${route}:message:v1`,
        text: message.text,
        parseMode: message.parseMode,
        replyMarkup: message.replyMarkup
      });
    }
  };
}

const STATIC_ROUTES = [
  'ignore',
  'guard.private_only',
  'guard.bot_sender',
  'command.unknown',
  'message.unsupported'
] as const satisfies readonly ImplementedBotRuntimeRoute[];

export function createStaticRouteHandlers({
  pool,
  getBotLocale,
  telegramClient
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
}): BotHandler<Route>[] {
  return STATIC_ROUTES.map((route) => createStaticRouteHandler({
    route,
    pool,
    getBotLocale,
    telegramClient
  })) as BotHandler<Route>[];
}
