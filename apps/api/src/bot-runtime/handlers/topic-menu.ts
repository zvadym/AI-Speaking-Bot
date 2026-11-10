import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { buildPersistentKeyboardState, buildPersistentReplyMarkup } from '../keyboard-state.js';
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
  fetchTopicCatalogItem(botKey: string, topicId: string): Promise<TopicRow | null>;
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

export interface TopicTelegramClient extends TelegramTextClient {
  answerTelegramCallbackQuery(
    callbackQueryId: string,
    text?: string,
    options?: { botKey?: string | null; showAlert?: boolean }
  ): Promise<unknown>;
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>
  ): Promise<unknown>;
}

interface TopicStateRow extends Record<string, unknown> {
  topic_enabled: unknown;
  topic_template_id: unknown;
  topic_pack_json: unknown;
  topic_pinned_message_id: unknown;
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

function stringList(value: unknown, maxItems = 10): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems)
    : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function levelList(value: unknown, level: string, fallback: unknown): string[] {
  const map = objectValue(value);
  return stringList(map[level] || map.default || fallback);
}

export function buildTopicPack(topic: TopicRow, levelRaw: unknown): Record<string, unknown> {
  const level = String(levelRaw || 'a1').trim().toLowerCase();
  const starters = levelList(
    topic.starter_questions_by_level_target,
    level,
    topic.starter_questions_target
  );
  const opening = String(topic.opening_prompt_target || '').trim() ||
    starters.find((item) => /[?¿？؟]/u.test(item)) || starters[0] || '';
  return {
    topic_id: String(topic.topic_id || '').trim().toLowerCase(),
    emoji: String(topic.emoji || '🧩').trim(),
    access_tier: String(topic.access_tier || 'all').trim().toLowerCase(),
    title_base: String(topic.title_base || topic.topic_id || '').trim(),
    goal_base: String(topic.goal_base || '').trim(),
    allowed_base: stringList(topic.allowed_base),
    subareas_json: Array.isArray(topic.subareas_json) ? topic.subareas_json : [],
    avoid_base: stringList(topic.avoid_base),
    starter_questions_target: starters,
    recovery_questions_target: levelList(
      topic.recovery_questions_by_level_target,
      level,
      topic.recovery_questions_target
    ),
    topic_mode: String(topic.topic_mode || 'open_chat').trim().toLowerCase(),
    speech_acts_base: stringList(topic.speech_acts_base),
    lexical_anchors_target: stringList(topic.lexical_anchors_target),
    grammar_targets_json: objectValue(topic.grammar_targets_json),
    bridge_patterns_target: stringList(topic.bridge_patterns_target),
    hard_block_base: stringList(topic.hard_block_base),
    soft_redirect_base: stringList(topic.soft_redirect_base),
    opening_prompt_target: opening,
    last_assistant_subarea: '',
    used_subareas: [],
    must_pivot_next_turn: false,
    last_assistant_question: /[?¿？؟]/u.test(opening) ? opening : '',
    turns_in_topic: opening ? 1 : 0
  };
}

async function persistTopicClear(
  client: PoolClient,
  update: PreparedUpdate
): Promise<Record<string, unknown>> {
  const chatId = update.input.chatId as number;
  const current = await client.query<TopicStateRow>(
    `SELECT topic_template_id, topic_pack_json, topic_pinned_message_id
       FROM user_bots
      WHERE chat_id = $1 AND bot_key = $2
      FOR UPDATE`,
    [chatId, update.botKey]
  );
  const row = current.rows[0];
  if (!row) throw new Error('topic_user_bot_missing');
  await client.query(
    `UPDATE user_bots
        SET topic_enabled = false,
            topic_template_id = NULL,
            topic_pinned_message_id = NULL,
            topic_pack_json = NULL,
            topic_updated_at = NOW(),
            updated_at = NOW()
      WHERE chat_id = $1 AND bot_key = $2`,
    [chatId, update.botKey]
  );
  await client.query(
    `INSERT INTO action_events (chat_id, bot_key, action_type, source, properties, occurred_at)
     VALUES ($1, $2, 'topic_clear', 'bot_runtime', $3::jsonb, NOW())`,
    [chatId, update.botKey, JSON.stringify({
      topic_id: String(row.topic_template_id || '') || null,
      via: 'telegram_callback',
      reason: 'manual_clear'
    })]
  );
  return { pinnedMessageId: Number(row.topic_pinned_message_id) || null };
}

async function persistTopicSelection(
  client: PoolClient,
  update: PreparedUpdate,
  pack: Record<string, unknown>,
  cardMessageId: number | null
): Promise<{ assistantMessageId: number | null }> {
  const chatId = update.input.chatId as number;
  const topicId = String(pack.topic_id || '').trim();
  const changed = await client.query(
    `UPDATE user_bots
        SET topic_enabled = true,
            topic_template_id = $3,
            topic_pinned_message_id = $4,
            topic_pack_json = $5::jsonb,
            topic_updated_at = NOW(),
            updated_at = NOW()
      WHERE chat_id = $1 AND bot_key = $2`,
    [chatId, update.botKey, topicId, cardMessageId, JSON.stringify(pack)]
  );
  if (changed.rowCount !== 1) throw new Error('topic_user_bot_missing');
  const opening = String(pack.opening_prompt_target || '').trim();
  const message = opening
    ? await client.query<{ id: string }>(
        `INSERT INTO messages (
           chat_id, role, content, translation_base, follow_up_hints, bot_key, topic_template_id
         ) VALUES ($1, 'assistant', $2, '', '[]', $3, $4)
         RETURNING id::text`,
        [chatId, opening, update.botKey, topicId]
      )
    : { rows: [] };
  await client.query(
    `INSERT INTO action_events (chat_id, bot_key, action_type, source, properties, occurred_at)
     VALUES ($1, $2, 'topic_set', 'bot_runtime', $3::jsonb, NOW())`,
    [chatId, update.botKey, JSON.stringify({
      topic_id: topicId,
      pinned_message_id: cardMessageId,
      via: 'telegram_callback'
    })]
  );
  return { assistantMessageId: message.rows[0] ? Number(message.rows[0].id) : null };
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

export function createTopicActionHandler({
  pool,
  getBotLocale,
  telegramClient,
  helpers,
  effectRunner = runBotUpdateEffect,
  keyboardStateLoader = fetchKeyboardState,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: TopicTelegramClient;
  helpers: TopicMenuHelpers;
  effectRunner?: typeof runBotUpdateEffect;
  keyboardStateLoader?: typeof fetchKeyboardState;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'callback.topic'> {
  return {
    route: 'callback.topic',
    version: BOT_RUNTIME_HANDLER_VERSIONS['callback.topic'],
    async execute(update: PreparedUpdate & { route: 'callback.topic' }) {
      const chatId = update.input.chatId;
      const callback = update.input.callbackQuery;
      if (!callback || chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new BotRuntimeHandlerError('invalid_topic_callback', { retryable: false });
      }
      const localeRaw = getBotLocale(update.botKey);
      const locale = localeRecord(localeRaw);
      const value = String(update.routingFacts.callback?.value || '').trim().toLowerCase();
      try {
        await telegramClient.answerTelegramCallbackQuery(
          callback.id,
          localeText(locale, 'callback_saved', 'Saved'),
          { botKey: update.botKey }
        );
      } catch {
        // The callback acknowledgement is ephemeral; durable work continues below.
      }

      if (value === 'menu') {
        const userTier = await helpers.fetchEffectiveTierForChat(chatId);
        const catalog = await helpers.fetchTopicCatalogRows(update.botKey, { userTier });
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.topic:menu:v1',
          text: localeText(locale, 'topic_menu_title', 'Choose a conversation topic:'),
          replyMarkup: helpers.buildTopicMenuReplyMarkup(catalog, localeRaw, { userTier })
        });
      }

      if (value === 'clear') {
        let pinnedMessageId: number | null;
        try {
          const effect = await effectRunner(pool, {
            decisionId: update.decisionId,
            stepKey: 'callback.topic:clear-state:v1',
            execute: (client) => persistTopicClear(client, update)
          });
          pinnedMessageId = Number(effect.result.pinnedMessageId) || null;
        } catch (error) {
          throw new BotRuntimeHandlerError('topic_clear_failed', {
            retryable: true,
            cause: error
          });
        }
        if (pinnedMessageId) {
          await Promise.allSettled([
            telegramClient.callTelegramApi(update.botKey, 'unpinChatMessage', {
              chat_id: chatId,
              message_id: pinnedMessageId
            })
          ]);
        }
        const row = await keyboardStateLoader(pool, chatId, update.botKey);
        const keyboard = buildPersistentKeyboardState(row, locale, update.input);
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.topic:cleared-message:v1',
          text: localeText(locale, 'topic_clear_done', 'Topic cleared.'),
          replyMarkup: buildPersistentReplyMarkup(keyboard)
        });
      }

      let userTier: string;
      let topic: TopicRow | null;
      let level: string;
      let previousPinnedMessageId: number | null;
      try {
        const [tier, item, state] = await Promise.all([
          helpers.fetchEffectiveTierForChat(chatId),
          helpers.fetchTopicCatalogItem(update.botKey, value),
          pool.query<{ level: unknown; topic_pinned_message_id: unknown }>(
            `SELECT level, topic_pinned_message_id
               FROM user_bots
              WHERE chat_id = $1 AND bot_key = $2
              LIMIT 1`,
            [chatId, update.botKey]
          )
        ]);
        userTier = tier;
        topic = item;
        level = String(state.rows[0]?.level || 'a1').trim().toLowerCase();
        previousPinnedMessageId = Number(state.rows[0]?.topic_pinned_message_id) || null;
      } catch (error) {
        throw new BotRuntimeHandlerError('topic_context_unavailable', {
          retryable: true,
          cause: error
        });
      }
      if (!topic) {
        throw new BotRuntimeHandlerError('unknown_topic', { retryable: false });
      }
      if (String(topic.access_tier || 'all').toLowerCase() === 'pro' && userTier !== 'pro') {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'callback.topic:subscription-required:v1',
          text: localeText(locale, 'topic_requires_subscription', 'This topic requires a Pro plan.')
        });
      }

      const pack = buildTopicPack(topic, level);
      const escape = (text: unknown) => String(text || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      const cardText = [
        `<b>${escape(localeText(locale, 'topic_card_title_prefix', 'Topic: '))}</b>${escape(pack.title_base)}`,
        `<b>${escape(localeText(locale, 'topic_card_goal_prefix', 'Goal: '))}</b>${escape(pack.goal_base)}`,
        '',
        `<i>${escape(localeText(locale, 'topic_card_rules_line', 'Keep the conversation within this topic.'))}</i>`
      ].join('\n');
      const card = await textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'callback.topic:card:v1',
        text: cardText,
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [[
            {
              text: localeText(locale, 'topic_btn_change', 'Change'),
              callback_data: 'topic:menu'
            },
            {
              text: localeText(locale, 'topic_btn_clear', 'Clear'),
              callback_data: 'topic:clear'
            }
          ]]
        }
      });
      const cardMessageId = card.telegramMessageId || null;
      await Promise.allSettled([
        previousPinnedMessageId
          ? telegramClient.callTelegramApi(update.botKey, 'unpinChatMessage', {
              chat_id: chatId,
              message_id: previousPinnedMessageId
            })
          : Promise.resolve(),
        cardMessageId
          ? telegramClient.callTelegramApi(update.botKey, 'pinChatMessage', {
              chat_id: chatId,
              message_id: cardMessageId,
              disable_notification: true
            })
          : Promise.resolve()
      ]);

      let assistantMessageId: number | null;
      try {
        const effect = await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'callback.topic:select-state:v1',
          execute: (client) => persistTopicSelection(client, update, pack, cardMessageId)
        });
        assistantMessageId = effect.result.assistantMessageId;
      } catch (error) {
        throw new BotRuntimeHandlerError('topic_save_failed', {
          retryable: true,
          cause: error
        });
      }

      const opening = String(pack.opening_prompt_target || '').trim();
      if (!opening || !assistantMessageId) return card;
      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'callback.topic:starter:v1',
        text: opening,
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: localeText(locale, 'btn_translation', 'Translation'),
                callback_data: `tr:${assistantMessageId}:000`
              },
              {
                text: localeText(locale, 'btn_vocab', 'Vocabulary'),
                callback_data: `voc:${assistantMessageId}:000`
              }
            ],
            [{
              text: localeText(locale, 'btn_follow_up_hints', 'Reply ideas'),
              callback_data: `hint:${assistantMessageId}:000`
            }]
          ]
        }
      });
    }
  };
}
