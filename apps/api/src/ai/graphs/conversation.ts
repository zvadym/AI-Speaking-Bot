import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { Pool } from 'pg';
import { sanitizeTelegramHtml } from '../../shared/telegram-delivery.js';
import type { BotAiClient, ConversationAiInput } from '../client.js';
import type { PreparedUpdate } from '../../bot-runtime/contracts.js';
import {
  conversationLocaleText,
  conversationReplyMarkup,
  executeConversation,
  finishConversationOnboarding,
  onboardingReplyText,
  prepareConversationOnboarding,
  suggestedOnboardingLevel,
  type ConversationEffectResult,
  type ConversationOnboardingContext,
  type ConversationTelegramClient
} from '../../bot-runtime/conversation/conversation.js';
import { attachConversationAudio, recordVoiceUsage } from '../../bot-runtime/conversation/conversation-audio.js';
import { findCompletedBotUpdateEffect, runBotUpdateEffect } from '../../bot-runtime/execution/effect-repository.js';
import { BotRuntimeHandlerError, type BotHandlerOutcome } from '../../bot-runtime/handler-registry.js';
import { startTelegramTyping } from '../../bot-runtime/delivery/immediate-telegram-ack.js';
import type { MessagePresentationService, PresentationKey } from '../../bot-runtime/delivery/message-presentation.js';
import { buildOnboardingCompletionMarkup } from '../../bot-runtime/onboarding/onboarding.js';
import type { ConversationProgress } from '../../bot-runtime/middleware/progress.js';
import { enforcePracticeQuota, type PracticeQuotaGuard } from '../../bot-runtime/conversation/practice-quota.js';
import { createTelegramDraft } from '../../bot-runtime/delivery/telegram-draft.js';
import { deliverTelegramText } from '../../bot-runtime/delivery/telegram-text-delivery.js';

export interface VoiceTelegramClient extends ConversationTelegramClient {
  downloadTelegramFile(fileId: string, options: { botKey: string }): Promise<Buffer>;
}

interface TextConversationDependencies {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: ConversationTelegramClient;
  ai: BotAiClient;
  webappUrl: string;
  presentation?: MessagePresentationService;
  quotaGuard?: PracticeQuotaGuard;
  withProgress?: ConversationProgress;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}

interface VoiceConversationDependencies extends Omit<TextConversationDependencies, 'telegramClient'> {
  telegramClient: VoiceTelegramClient;
}

const ConversationState = Annotation.Root({
  update: Annotation<PreparedUpdate>(),
  text: Annotation<string>(),
  fileId: Annotation<string>(),
  duration: Annotation<number>(),
  locale: Annotation<Record<string, unknown>>(),
  onboarding: Annotation<ConversationOnboardingContext | null>(),
  result: Annotation<ConversationEffectResult & { transcript?: string }>(),
  reply: Annotation<string>(),
  presentationKey: Annotation<PresentationKey | null>(),
  outcome: Annotation<BotHandlerOutcome>()
});

const VoiceGenerationContext = Annotation.Root({
  onReplyText: Annotation<ConversationAiInput['onReplyText']>()
});

function localeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// Text and voice share delivery and onboarding behavior. Their input checks
// and generation workflows are attached by the two concrete factories below.
function conversationDeliveryGraph({
  pool, getBotLocale, telegramClient, ai, webappUrl, presentation,
  quotaGuard = enforcePracticeQuota,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: TextConversationDependencies) {
  return new StateGraph(ConversationState)
    .addNode('checkQuota', async ({ update }) => {
      const quota = await quotaGuard({ pool, update, getBotLocale, telegramClient, webappUrl });
      return quota.allowed ? {} : { outcome: quota.outcome };
    })
    .addNode('prepareOnboarding', async ({ update, locale }) => {
      const inputMode = update.route === 'message.voice' ? 'voice' : 'text';
      const localeRaw = inputMode === 'voice' ? locale : getBotLocale(update.botKey);
      return {
        locale: localeRecord(localeRaw),
        onboarding: await prepareConversationOnboarding(pool, update, inputMode, localeRaw)
      };
    })
    .addNode('deliverExplanation', async ({ update, result }) => {
      const explanation = sanitizeTelegramHtml(result.response.explanation_html);
      if (!result.response.is_target_language) {
        return { outcome: await textDeliverer({
          pool, update, telegramClient,
          stepKey: `${update.route}:language-mismatch:v1`,
          text: explanation, parseMode: 'HTML'
        }) };
      }
      if (result.response.has_mistakes && explanation) {
        await textDeliverer({
          pool, update, telegramClient,
          stepKey: `${update.route}:correction:v1`,
          text: explanation, parseMode: 'HTML'
        });
      }
      return {};
    })
    .addNode('deliverReply', async ({ update, result, onboarding, locale }) => {
      const reply = String(result.response.reply_text || '').trim();
      const assistantMessageId = update.route === 'message.voice'
        ? Number(result.assistantMessageId)
        : result.assistantMessageId;
      if (!reply || !assistantMessageId || (update.route === 'message.voice'
        && (!Number.isSafeInteger(assistantMessageId) || assistantMessageId <= 0))) {
        throw new BotRuntimeHandlerError('conversation_reply_missing', { retryable: false });
      }
      const replyText = onboarding ? onboardingReplyText(reply, onboarding, result.response) : reply;
      const replyMarkup = onboarding
        ? buildOnboardingCompletionMarkup(onboarding.locale, suggestedOnboardingLevel(result.response))
        : conversationReplyMarkup(assistantMessageId, locale);
      const outcome = await textDeliverer({
        pool, update, telegramClient, stepKey: `${update.route}:reply:v1`,
        text: replyText, replyMarkup
      });
      let presentationKey: PresentationKey | null = null;
      if (presentation && outcome.telegramMessageId) {
        presentationKey = {
          messageId: assistantMessageId, telegramMessageId: outcome.telegramMessageId,
          chatId: update.input.chatId as number, botKey: update.botKey
        };
        await presentation.initialize(presentationKey, replyText, replyMarkup);
      }
      return { outcome, reply, presentationKey };
    })
    .addNode('attachAudio', async ({ update, result, onboarding, presentationKey, reply }) => {
      if (!presentation || !presentationKey || onboarding || result.replyMode !== 'voice') return {};
      const blocked = await attachConversationAudio({
        pool, update, ai, presentation, key: presentationKey, reply, effectRunner,
        quotaCheck: () => quotaGuard({ pool, update, getBotLocale, telegramClient, webappUrl })
      });
      return blocked ? { outcome: blocked } : {};
    })
    .addNode('finishOnboarding', async ({ update, onboarding, result, text }) => {
      if (!onboarding) return {};
      return { outcome: await finishConversationOnboarding({
        pool, update, onboarding, response: result.response,
        userText: result.transcript ?? text,
        getBotLocale, telegramClient, textDeliverer,
        stepPrefix: update.route === 'message.voice' ? 'message.voice' : 'message.text'
      }) };
    })
    .addConditionalEdges('deliverExplanation', ({ result }) => result.response.is_target_language ? 'deliverReply' : END, ['deliverReply', END])
    .addEdge('deliverReply', 'attachAudio')
    .addEdge('attachAudio', 'finishOnboarding')
    .addEdge('finishOnboarding', END);
}

export function createTextConversationGraph(dependencies: TextConversationDependencies) {
  const {
    pool, telegramClient, ai,
    effectRunner = runBotUpdateEffect,
    textDeliverer = deliverTelegramText,
    withProgress = async (_update, operation) => operation()
  } = dependencies;
  return conversationDeliveryGraph(dependencies)
    .addNode('validateInput', ({ update }) => {
      const chatId = update.input.chatId;
      const text = String(update.input.message.text || '').trim();
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !text) {
        throw new BotRuntimeHandlerError('invalid_text_message', { retryable: false });
      }
      return { text };
    })
    .addNode('generateTurn', async ({ update, text, onboarding }) => ({
      result: await withProgress(update, async () => {
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
          throw new BotRuntimeHandlerError('conversation_failed', { retryable: true, cause: error });
        } finally {
          await draft.stop();
        }
      })
    }))
    .addNode('deliverOnboardingInput', async ({ update, text, onboarding }) => {
      if (onboarding) {
        await textDeliverer({
          pool, update, telegramClient, stepKey: 'message.text:onboarding-input:v2',
          text: `${onboarding.locale.text_input_header}\n${text}`
        });
      }
      return {};
    })
    .addEdge(START, 'validateInput')
    .addEdge('validateInput', 'checkQuota')
    .addConditionalEdges('checkQuota', ({ outcome }) => outcome ? END : 'prepareOnboarding', ['prepareOnboarding', END])
    .addEdge('prepareOnboarding', 'generateTurn')
    .addEdge('generateTurn', 'deliverOnboardingInput')
    .addEdge('deliverOnboardingInput', 'deliverExplanation')
    .compile();
}

export function createVoiceConversationGraph(dependencies: VoiceConversationDependencies) {
  const {
    pool, getBotLocale, telegramClient, ai,
    effectRunner = runBotUpdateEffect,
    textDeliverer = deliverTelegramText,
    withProgress = async (_update, operation) => operation()
  } = dependencies;
  const generation = new StateGraph(ConversationState, { context: VoiceGenerationContext })
    .addNode('transcribe', async ({ update, fileId }) => {
      const transcription = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'message.voice:transcription:v1',
        execute: async (client) => {
          // An update retried after an upgrade may have the old combined result.
          const previous = await findCompletedBotUpdateEffect<ConversationEffectResult & { transcript: string }>(
            client, update.decisionId, 'message.voice:conversation:v1'
          );
          if (previous?.transcript) return { transcript: previous.transcript };
          let audio: Buffer;
          try {
            audio = await telegramClient.downloadTelegramFile(fileId, { botKey: update.botKey });
          } catch (error) {
            throw new BotRuntimeHandlerError('telegram_voice_download_failed', { retryable: true, cause: error });
          }
          const transcript = await ai.transcribe(update.botKey, audio, {
            trace: {
              decisionId: update.decisionId, chatId: update.input.chatId as number,
              botKey: update.botKey, route: update.route
            }
          });
          if (!transcript) throw new Error('voice_transcript_empty');
          return { transcript };
        }
      });
      return { text: transcription.result.transcript };
    })
    .addNode('deliverTranscript', async ({ update, text, onboarding, locale }) => {
      await textDeliverer({
        pool, update, telegramClient, stepKey: 'message.voice:transcript:v1',
        text: onboarding
          ? `${onboarding.locale.voice_input_header}\n${text}`
          : `${conversationLocaleText(locale, 'user_text_prefix_multiline', 'You said:\n')}${text}`,
        replyMarkup: onboarding ? null : {
          inline_keyboard: [[{
            text: conversationLocaleText(locale, 'btn_translation', 'Translation'),
            callback_data: 'trv:1'
          }]]
        }
      });
      // A message clears typing; renew it before tutor generation.
      startTelegramTyping({ telegramClient, botKey: update.botKey, input: update.input });
      return {};
    })
    .addNode('generateResponse', async ({ update, text, duration, onboarding }, runtime) => {
      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'message.voice:conversation:v1',
        execute: async (client) => {
          const conversation = await executeConversation(
            client, update, ai, text, 'voice', onboarding?.ai, runtime.context?.onReplyText
          );
          await recordVoiceUsage(client, update, 'in', duration);
          return { ...conversation, transcript: text };
        }
      });
      return { result: effect.result };
    })
    .addEdge(START, 'transcribe')
    .addEdge('transcribe', 'deliverTranscript')
    .addEdge('deliverTranscript', 'generateResponse')
    .addEdge('generateResponse', END)
    .compile();

  return conversationDeliveryGraph(dependencies)
    .addNode('validateInput', async ({ update }) => {
      const chatId = update.input.chatId;
      const fileId = String(update.input.message.voiceFileId || '').trim();
      const duration = Number(update.input.message.voiceDuration || 0);
      const locale = localeRecord(getBotLocale(update.botKey));
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !fileId) {
        throw new BotRuntimeHandlerError('invalid_voice_message', { retryable: false });
      }
      if (duration < 1 || duration > 90) {
        return { outcome: await textDeliverer({
          pool, update, telegramClient,
          stepKey: duration < 1 ? 'message.voice:too-short:v1' : 'message.voice:too-long:v1',
          text: duration < 1
            ? conversationLocaleText(locale, 'msg_too_short', 'The voice message is too short.')
            : conversationLocaleText(locale, 'msg_too_long', 'Please send a voice message of up to 90 seconds.')
        }) };
      }
      return { fileId, duration, locale };
    })
    .addNode('deliverLengthAdvice', async ({ update, duration, locale }) => {
      if (duration > 40) {
        await textDeliverer({
          pool, update, telegramClient, stepKey: 'message.voice:length-tip:v1',
          text: conversationLocaleText(locale, 'msg_voice_length_tip', 'For more focused practice, try to keep each voice message to 30–45 seconds.')
        });
      }
      return {};
    })
    .addNode('generateTurn', async (state) => ({
      result: await withProgress(state.update, async () => {
        const { update } = state;
        startTelegramTyping({ telegramClient, botKey: update.botKey, input: update.input });
        const draft = createTelegramDraft(telegramClient, update);
        try {
          const generated = await generation.invoke(state, { context: { onReplyText: draft.update } });
          return generated.result;
        } catch (error) {
          if (error instanceof BotRuntimeHandlerError) throw error;
          throw new BotRuntimeHandlerError('voice_conversation_failed', { retryable: true, cause: error });
        } finally {
          await draft.stop();
        }
      })
    }), { subgraphs: [generation] })
    .addEdge(START, 'validateInput')
    .addConditionalEdges('validateInput', ({ outcome }) => outcome ? END : 'checkQuota', ['checkQuota', END])
    // Advice is sent only after quota is allowed, before onboarding is prepared.
    .addConditionalEdges('checkQuota', ({ outcome }) => outcome ? END : 'deliverLengthAdvice', ['deliverLengthAdvice', END])
    .addEdge('deliverLengthAdvice', 'prepareOnboarding')
    .addEdge('prepareOnboarding', 'generateTurn')
    .addEdge('generateTurn', 'deliverExplanation')
    .compile();
}
