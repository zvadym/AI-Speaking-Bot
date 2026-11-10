import type { Pool, PoolClient } from 'pg';
import { sanitizeTelegramHtml } from '../../shared/telegram-delivery.js';
import type { BotAiClient, ConversationAiInput, ConversationAiResult } from '../bot-ai.js';
import type { PreparedUpdate } from '../contracts.js';
import { fetchKeyboardState } from '../context-loader.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import {
  buildPersistentKeyboardState,
  buildPersistentReplyMarkup
} from '../keyboard-state.js';
import {
  buildOnboardingCompletionMarkup,
  completeOnboardingSession,
  getOnboardingLocale,
  loadOnboardingSession,
  normalizeSuggestedLevel,
  prepareOnboardingPractice,
  renderOnboardingText,
  type OnboardingLocale,
  type OnboardingSession,
  type SuggestedLevel
} from '../onboarding.js';
import { runBotPipelineStage } from '../pipeline.js';
import { startTelegramTyping } from '../immediate-telegram-ack.js';
import { createTelegramDraft } from '../telegram-draft.js';
import type { MessagePresentationService } from '../message-presentation.js';
import { attachConversationAudio } from '../conversation-audio.js';
import {
  enforcePracticeQuota,
  type PracticeQuotaGuard
} from '../practice-quota.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';

type Locale = Record<string, unknown>;

export interface ConversationTelegramClient extends TelegramTextClient {
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
}

interface ConversationContext extends Record<string, unknown> {
  level: string;
  reply_mode: string;
  profile_summary: string;
  short_summary: string;
  topic_enabled: boolean;
  topic_template_id: string | null;
  topic_pack_json: unknown;
}

export interface ConversationEffectResult extends Record<string, unknown> {
  assistantMessageId: number | null;
  response: ConversationAiResult;
  replyMode: string;
}

export interface ConversationOnboardingContext {
  session: OnboardingSession;
  locale: OnboardingLocale;
  ai: NonNullable<ConversationAiInput['onboarding']>;
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

function topicValue(raw: unknown, enabled: unknown): Record<string, unknown> | null {
  if (!enabled) return null;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

export async function executeConversation(
  client: PoolClient,
  update: PreparedUpdate,
  ai: BotAiClient,
  text: string,
  inputMode: 'text' | 'voice' = 'text',
  onboarding: ConversationAiInput['onboarding'] = null,
  onReplyText?: ConversationAiInput['onReplyText']
): Promise<ConversationEffectResult> {
  const chatId = update.input.chatId as number;
  const contextResult = await client.query<ConversationContext>(
    `SELECT
       ub.level,
       ub.reply_mode,
       ub.topic_enabled,
       ub.topic_template_id,
       ub.topic_pack_json,
       COALESCE(s.profile_summary, '') AS profile_summary,
       COALESCE(s.short_summary, '') AS short_summary
     FROM user_bots ub
     LEFT JOIN user_summaries s
       ON s.chat_id = ub.chat_id AND s.bot_key = ub.bot_key
     WHERE ub.chat_id = $1 AND ub.bot_key = $2
     LIMIT 1`,
    [chatId, update.botKey]
  );
  const context = contextResult.rows[0];
  if (!context) throw new Error('conversation_user_bot_missing');
  const historyResult = await client.query<{ role: string; content: string }>(
    `SELECT role, content
       FROM (
         SELECT id, role, content
           FROM messages
          WHERE chat_id = $1
            AND bot_key = $2
            AND (($3::boolean AND topic_template_id = $4) OR (NOT $3::boolean AND topic_template_id IS NULL))
          ORDER BY id DESC
          LIMIT 20
       ) recent
      ORDER BY id`,
    [chatId, update.botKey, Boolean(context.topic_enabled), context.topic_template_id]
  );
  const topic = topicValue(context.topic_pack_json, context.topic_enabled);
  const response = await ai.respond({
    botKey: update.botKey,
    level: String(context.level || 'a1'),
    inputMode,
    text,
    profileSummary: String(context.profile_summary || ''),
    shortSummary: String(context.short_summary || ''),
    history: historyResult.rows,
    topic,
    onboarding,
    onReplyText,
    trace: {
      decisionId: update.decisionId,
      chatId,
      botKey: update.botKey,
      route: update.route
    }
  });
  await client.query(
    `INSERT INTO messages (chat_id, role, content, bot_key, topic_template_id)
     VALUES ($1, 'user', $2, $3, $4)`,
    [
      chatId,
      text,
      update.botKey,
      context.topic_enabled ? context.topic_template_id : null
    ]
  );

  let assistantMessageId: number | null = null;
  const reply = String(response.reply_text || '').trim();
  if (response.is_target_language && reply) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages (
         chat_id, role, content, translation_base, follow_up_hints, bot_key, topic_template_id
       ) VALUES ($1, 'assistant', $2, '', '[]', $3, $4)
       RETURNING id::text`,
      [
        chatId,
        reply,
        update.botKey,
        context.topic_enabled ? context.topic_template_id : null
      ]
    );
    assistantMessageId = Number(inserted.rows[0]?.id) || null;
  }
  return {
    assistantMessageId,
    response,
    replyMode: onboarding ? 'text' : String(context.reply_mode || 'text')
  };
}

export async function prepareConversationOnboarding(
  pool: Pool,
  update: PreparedUpdate,
  inputMode: 'text' | 'voice',
  localeRaw: unknown
): Promise<ConversationOnboardingContext | null> {
  const chatId = update.input.chatId;
  if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0) return null;
  const locale = getOnboardingLocale(localeRaw);
  if (!locale) return null;
  let session = await loadOnboardingSession(pool, chatId, update.botKey);
  if (!session) return null;
  if (session.state === 'completed') {
    if (session.completion_decision_id !== update.decisionId) return null;
  } else {
    session = await prepareOnboardingPractice(pool, {
      chatId,
      botKey: update.botKey,
      inputMode
    });
    if (!session) return null;
  }
  const scenario = session.scenario;
  const localized = scenario && scenario !== 'freeform' ? locale.scenarios[scenario] : null;
  return {
    session,
    locale,
    ai: {
      scenario: scenario || 'freeform',
      prompt: localized?.prompt || '',
      example: localized?.example || ''
    }
  };
}

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’]+/gu, ' ')
    .trim()
    .split(/\s+/gu)
    .filter(Boolean);
}

export function classifyOnboardingResponseStyle(textValue: string, example: string) {
  const actual = normalizedWords(textValue);
  const expected = normalizedWords(example);
  if (!actual.length || !expected.length) return 'unknown' as const;
  const expectedSet = new Set(expected);
  const overlap = actual.filter((word) => expectedSet.has(word)).length;
  return overlap / Math.max(actual.length, expected.length) >= 0.8
    ? 'repeated_example' as const
    : 'custom' as const;
}

export function suggestedOnboardingLevel(response: ConversationAiResult): SuggestedLevel | null {
  const confidence = String(response.suggested_level_confidence || '').trim().toLowerCase();
  if (confidence !== 'medium' && confidence !== 'high') return null;
  return normalizeSuggestedLevel(response.suggested_level);
}

export function onboardingReplyText(
  reply: string,
  onboarding: ConversationOnboardingContext,
  response: ConversationAiResult
): string {
  const level = suggestedOnboardingLevel(response);
  if (!level) return reply;
  return [
    reply,
    renderOnboardingText(onboarding.locale.level_suggestion, { suggested_level: level })
  ].join('\n\n');
}

export async function finishConversationOnboarding({
  pool,
  update,
  onboarding,
  response,
  userText,
  getBotLocale,
  telegramClient,
  textDeliverer,
  stepPrefix
}: {
  pool: Pool;
  update: PreparedUpdate;
  onboarding: ConversationOnboardingContext;
  response: ConversationAiResult;
  userText: string;
  getBotLocale(botKey: string): unknown;
  telegramClient: TelegramTextClient;
  textDeliverer: typeof deliverTelegramText;
  stepPrefix: 'message.text' | 'message.voice';
}) {
  const chatId = update.input.chatId as number;
  const level = suggestedOnboardingLevel(response);
  const style = classifyOnboardingResponseStyle(userText, onboarding.ai.example);
  await completeOnboardingSession(pool, {
    chatId,
    botKey: update.botKey,
    suggestedLevel: level,
    decisionId: update.decisionId,
    responseStyle: style
  });
  const row = await fetchKeyboardState(pool, chatId, update.botKey);
  const keyboard = buildPersistentKeyboardState(row, getBotLocale(update.botKey), update.input);
  return textDeliverer({
    pool,
    update,
    telegramClient,
    stepKey: `${stepPrefix}:onboarding-success:v2`,
    text: onboarding.locale.success,
    replyMarkup: buildPersistentReplyMarkup(keyboard)
  });
}

export function conversationReplyMarkup(messageId: number, locale: Locale) {
  return {
    inline_keyboard: [
      [
        {
          text: localeText(locale, 'btn_translation', 'Translation'),
          callback_data: `tr:${messageId}:000`
        },
        {
          text: localeText(locale, 'btn_vocab', 'Vocabulary'),
          callback_data: `voc:${messageId}:000`
        }
      ],
      [{
        text: localeText(locale, 'btn_follow_up_hints', 'Reply ideas'),
        callback_data: `hint:${messageId}:000`
      }]
    ]
  };
}

export function createTextConversationHandler({
  pool,
  getBotLocale,
  telegramClient,
  ai,
  webappUrl,
  presentation,
  quotaGuard = enforcePracticeQuota,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: ConversationTelegramClient;
  ai: BotAiClient;
  webappUrl: string;
  presentation?: MessagePresentationService;
  quotaGuard?: PracticeQuotaGuard;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'message.text'> {
  return {
    route: 'message.text',
    version: BOT_RUNTIME_HANDLER_VERSIONS['message.text'],
    async execute(update: PreparedUpdate & { route: 'message.text' }, pipeline) {
      const chatId = update.input.chatId;
      const text = String(update.input.message.text || '').trim();
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !text) {
        throw new BotRuntimeHandlerError('invalid_text_message', { retryable: false });
      }
      const quota = await quotaGuard({
        pool,
        update,
        getBotLocale,
        telegramClient,
        webappUrl
      });
      if (!quota.allowed) return quota.outcome;

      const localeRaw = getBotLocale(update.botKey);
      const onboarding = await prepareConversationOnboarding(pool, update, 'text', localeRaw);

      let result: ConversationEffectResult;
      result = await runBotPipelineStage(pipeline, 'conversation.generate', async () => {
        startTelegramTyping({ telegramClient, botKey: update.botKey, input: update.input });
        const draft = createTelegramDraft(telegramClient, update);
        try {
          const effect = await effectRunner(pool, {
            decisionId: update.decisionId,
            stepKey: 'message.text:conversation:v1',
            execute: (client) => executeConversation(client, update, ai, text, 'text', onboarding?.ai, draft.update)
          });
          return effect.result;
        } catch (error) {
          if (error instanceof BotRuntimeHandlerError) throw error;
          throw new BotRuntimeHandlerError('conversation_failed', {
            retryable: true,
            cause: error
          });
        } finally {
          await draft.stop();
        }
      });

      const locale = localeRecord(localeRaw);
      if (onboarding) {
        await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.text:onboarding-input:v2',
          text: `${onboarding.locale.text_input_header}\n${text}`
        });
      }
      const explanation = sanitizeTelegramHtml(result.response.explanation_html);
      if (!result.response.is_target_language) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.text:language-mismatch:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }

      if (result.response.has_mistakes && explanation) {
        await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.text:correction:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }
      const reply = String(result.response.reply_text || '').trim();
      if (!reply || !result.assistantMessageId) {
        throw new BotRuntimeHandlerError('conversation_reply_missing', { retryable: false });
      }
      const replyText = onboarding ? onboardingReplyText(reply, onboarding, result.response) : reply;
      const replyMarkup = onboarding
        ? buildOnboardingCompletionMarkup(onboarding.locale, suggestedOnboardingLevel(result.response))
        : conversationReplyMarkup(result.assistantMessageId, locale);
      const replyDelivery = await textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'message.text:reply:v1',
        text: replyText,
        replyMarkup
      });
      if (presentation && replyDelivery.telegramMessageId) {
        const key = { messageId: result.assistantMessageId, telegramMessageId: replyDelivery.telegramMessageId, chatId, botKey: update.botKey };
        await presentation.initialize(key, replyText, replyMarkup);
        if (!onboarding && result.replyMode === 'voice') {
          const blocked = await attachConversationAudio({
            pool, update, ai, presentation, key, reply, effectRunner,
            quotaCheck: () => quotaGuard({ pool, update, getBotLocale, telegramClient, webappUrl })
          });
          if (blocked) return blocked;
        }
      }
      if (!onboarding) return replyDelivery;
      return finishConversationOnboarding({
        pool,
        update,
        onboarding,
        response: result.response,
        userText: text,
        getBotLocale,
        telegramClient,
        textDeliverer,
        stepPrefix: 'message.text'
      });
    }
  };
}
