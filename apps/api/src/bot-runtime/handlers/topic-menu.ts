import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;
type TopicRow = Record<string, unknown>;

export interface TopicMenuHelpers {
  fetchEffectiveTierForChat(chatId: number): Promise<string>;
  fetchTopicCatalogRows(
    botKey: string,
    options: { userTier: string }
  ): Promise<TopicRow[]>;
  normalizeTopicPackValue(value: unknown): Record<string, unknown> | null;
  formatTopicMenuLabel(
    topic: TopicRow,
    locale: unknown,
    options: { userTier: string }
  ): string;
  buildTopicMenuReplyMarkup(
    catalog: TopicRow[],
    locale: unknown,
    options: { userTier: string }
  ): object;
}

interface TopicStateRow extends Record<string, unknown> {
  topic_enabled: unknown;
  topic_template_id: unknown;
  topic_pack_json: unknown;
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

export function createTopicMenuHandler({
  pool,
  getBotLocale,
  telegramClient,
  helpers,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  helpers: TopicMenuHelpers;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'command.topic'> {
  return {
    route: 'command.topic',
    version: BOT_RUNTIME_HANDLER_VERSIONS['command.topic'],
    async execute(update: PreparedUpdate & { route: 'command.topic' }) {
      const chatId = update.input.chatId;
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_topic_chat_id', { retryable: false });
      }

      let userTier: string;
      let state: TopicStateRow;
      let catalog: TopicRow[];
      try {
        const [resolvedTier, stateResult] = await Promise.all([
          helpers.fetchEffectiveTierForChat(chatId),
          pool.query<TopicStateRow>(
            `SELECT topic_enabled, topic_template_id, topic_pack_json
             FROM user_bots
             WHERE chat_id = $1
               AND bot_key = $2
             LIMIT 1`,
            [chatId, update.botKey]
          )
        ]);
        userTier = resolvedTier;
        state = stateResult.rows[0] || {} as TopicStateRow;
        catalog = await helpers.fetchTopicCatalogRows(update.botKey, { userTier });
      } catch (error) {
        throw new BotRuntimeHandlerError('topic_context_unavailable', {
          retryable: true,
          cause: error
        });
      }

      const localeRaw = getBotLocale(update.botKey);
      const locale = localeRecord(localeRaw);
      const pack = helpers.normalizeTopicPackValue(state.topic_pack_json);
      const selectedTopicId = String(state.topic_template_id || '').trim().toLowerCase();
      const catalogTopic = catalog.find((item) =>
        String(item.topic_id || '').trim().toLowerCase() === selectedTopicId
      ) || null;
      const activeTopic = state.topic_enabled
        ? { ...(catalogTopic || {}), ...(pack || {}) }
        : null;
      const topicTitle = activeTopic
        ? helpers.formatTopicMenuLabel(activeTopic, localeRaw, { userTier })
        : '';
      const currentPrefix = localeText(locale, 'topic_menu_current_prefix', 'Current topic: ');
      const currentNone = localeText(
        locale,
        'topic_menu_current_none',
        'Current topic: none active.'
      );
      const text = [
        localeText(locale, 'topic_menu_title', 'Choose a conversation topic 👇'),
        '',
        topicTitle ? `${currentPrefix}${topicTitle}` : currentNone
      ].join('\n');

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'command.topic:menu:v1',
        text,
        replyMarkup: helpers.buildTopicMenuReplyMarkup(catalog, localeRaw, { userTier })
      });
    }
  };
}
