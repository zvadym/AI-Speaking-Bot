import type { Pool } from 'pg';
import { sanitizeTelegramHtml } from '../../shared/telegram-delivery.js';
import type { BotAiClient } from '../bot-ai.js';
import type { PreparedUpdate } from '../contracts.js';
import { findCompletedBotUpdateEffect, runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { runBotPipelineStage } from '../pipeline.js';
import { startTelegramTyping } from '../immediate-telegram-ack.js';
import { createTelegramDraft } from '../telegram-draft.js';
import type { MessagePresentationService } from '../message-presentation.js';
import { attachConversationAudio, recordVoiceUsage } from '../conversation-audio.js';
import {
  enforcePracticeQuota,
  type PracticeQuotaGuard
} from '../practice-quota.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';
import type { TelegramVoiceClient } from '../telegram-voice-delivery.js';
import {
  conversationReplyMarkup,
  executeConversation,
  finishConversationOnboarding,
  onboardingReplyText,
  prepareConversationOnboarding,
  suggestedOnboardingLevel,
  type ConversationEffectResult
} from './conversation.js';
import { buildOnboardingCompletionMarkup } from '../onboarding.js';

type Locale = Record<string, unknown>;

export interface VoiceTelegramClient extends TelegramTextClient, TelegramVoiceClient {
  downloadTelegramFile(fileId: string, options: { botKey: string }): Promise<Buffer>;
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
}

interface VoiceConversationResult extends ConversationEffectResult {
  transcript: string;
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

export function createVoiceConversationHandler({
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
  telegramClient: VoiceTelegramClient;
  ai: BotAiClient;
  webappUrl: string;
  presentation?: MessagePresentationService;
  quotaGuard?: PracticeQuotaGuard;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'message.voice'> {
  return {
    route: 'message.voice',
    version: BOT_RUNTIME_HANDLER_VERSIONS['message.voice'],
    async execute(update: PreparedUpdate & { route: 'message.voice' }, pipeline) {
      const chatId = update.input.chatId;
      const fileId = String(update.input.message.voiceFileId || '').trim();
      const duration = Number(update.input.message.voiceDuration || 0);
      const locale = localeRecord(getBotLocale(update.botKey));
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !fileId) {
        throw new BotRuntimeHandlerError('invalid_voice_message', { retryable: false });
      }
      if (duration < 1) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:too-short:v1',
          text: localeText(locale, 'msg_too_short', 'The voice message is too short.')
        });
      }
      if (duration > 90) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:too-long:v1',
          text: localeText(locale, 'msg_too_long', 'Please send a voice message of up to 90 seconds.')
        });
      }
      const entryQuota = await quotaGuard({
        pool,
        update,
        getBotLocale,
        telegramClient,
        webappUrl
      });
      if (!entryQuota.allowed) return entryQuota.outcome;
      if (duration > 40) {
        await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:length-tip:v1',
          text: localeText(locale, 'msg_voice_length_tip', 'For more focused practice, try to keep each voice message to 30–45 seconds.')
        });
      }
      const onboarding = await prepareConversationOnboarding(pool, update, 'voice', locale);

      let result: VoiceConversationResult;
      result = await runBotPipelineStage(pipeline, 'conversation.generate', async () => {
        startTelegramTyping({ telegramClient, botKey: update.botKey, input: update.input });
        const draft = createTelegramDraft(telegramClient, update);
        try {
          const transcription = await effectRunner(pool, {
            decisionId: update.decisionId,
            stepKey: 'message.voice:transcription:v1',
            execute: async (client) => {
              // A retry after upgrading may already have the old combined result.
              const previous = await findCompletedBotUpdateEffect<VoiceConversationResult>(
                client, update.decisionId, 'message.voice:conversation:v1'
              );
              if (previous?.transcript) return { transcript: previous.transcript };
              let audio: Buffer;
              try {
                audio = await telegramClient.downloadTelegramFile(fileId, { botKey: update.botKey });
              } catch (error) {
                throw new BotRuntimeHandlerError('telegram_voice_download_failed', {
                  retryable: true,
                  cause: error
                });
              }
              const transcript = await ai.transcribe(update.botKey, audio, {
                trace: {
                  decisionId: update.decisionId,
                  chatId,
                  botKey: update.botKey,
                  route: update.route
                }
              });
              if (!transcript) throw new Error('voice_transcript_empty');
              return { transcript };
            }
          });
          const { transcript } = transcription.result;
          await textDeliverer({
            pool,
            update,
            telegramClient,
            stepKey: 'message.voice:transcript:v1',
            text: onboarding
              ? `${onboarding.locale.voice_input_header}\n${transcript}`
              : `${localeText(locale, 'user_text_prefix_multiline', 'You said:\n')}${transcript}`,
            replyMarkup: onboarding
              ? null
              : {
                  inline_keyboard: [[{
                    text: localeText(locale, 'btn_translation', 'Translation'),
                    callback_data: 'trv:1'
                  }]]
                }
          });
          // Telegram clears typing when a message arrives; renew it for generation.
          startTelegramTyping({ telegramClient, botKey: update.botKey, input: update.input });
          const effect = await effectRunner(pool, {
            decisionId: update.decisionId,
            stepKey: 'message.voice:conversation:v1',
            execute: async (client) => {
              const conversation = await executeConversation(
                client,
                update,
                ai,
                transcript,
                'voice',
                onboarding?.ai,
                draft.update
              );
              await recordVoiceUsage(client, update, 'in', duration);
              return { ...conversation, transcript };
            }
          });
          return effect.result;
        } catch (error) {
          if (error instanceof BotRuntimeHandlerError) throw error;
          throw new BotRuntimeHandlerError('voice_conversation_failed', {
            retryable: true,
            cause: error
          });
        } finally {
          await draft.stop();
        }
      });

      const explanation = sanitizeTelegramHtml(result.response.explanation_html);
      if (!result.response.is_target_language) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:language-mismatch:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }
      if (result.response.has_mistakes && explanation) {
        await textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:correction:v1',
          text: explanation,
          parseMode: 'HTML'
        });
      }
      const reply = String(result.response.reply_text || '').trim();
      const assistantMessageId = Number(result.assistantMessageId);
      if (!reply || !Number.isSafeInteger(assistantMessageId) || assistantMessageId <= 0) {
        throw new BotRuntimeHandlerError('conversation_reply_missing', { retryable: false });
      }

      const replyText = onboarding ? onboardingReplyText(reply, onboarding, result.response) : reply;
      const replyMarkup = onboarding
        ? buildOnboardingCompletionMarkup(onboarding.locale, suggestedOnboardingLevel(result.response))
        : conversationReplyMarkup(assistantMessageId, locale);
      const replyDelivery = await textDeliverer({
        pool, update, telegramClient, stepKey: 'message.voice:reply:v1',
        text: replyText, replyMarkup
      });
      if (presentation && replyDelivery.telegramMessageId) {
        const key = { messageId: assistantMessageId, telegramMessageId: replyDelivery.telegramMessageId, chatId, botKey: update.botKey };
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
        userText: result.transcript,
        getBotLocale,
        telegramClient,
        textDeliverer,
        stepPrefix: 'message.voice'
      });
    }
  };
}

export function createVoiceFeedbackHandler({
  pool,
  getBotLocale,
  telegramClient,
  ai,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: VoiceTelegramClient;
  ai: BotAiClient;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}): BotHandler<'pending_feedback.voice'> {
  return {
    route: 'pending_feedback.voice',
    version: BOT_RUNTIME_HANDLER_VERSIONS['pending_feedback.voice'],
    async execute(update: PreparedUpdate & { route: 'pending_feedback.voice' }) {
      const chatId = update.input.chatId;
      const fileId = String(update.input.message.voiceFileId || '').trim();
      if (chatId === null || !Number.isSafeInteger(chatId) || chatId <= 0 || !fileId) {
        throw new BotRuntimeHandlerError('invalid_voice_feedback', { retryable: false });
      }
      let audio: Buffer;
      try {
        audio = await telegramClient.downloadTelegramFile(fileId, { botKey: update.botKey });
      } catch (error) {
        throw new BotRuntimeHandlerError('feedback_voice_download_failed', {
          retryable: true,
          cause: error
        });
      }
      try {
        await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'pending_feedback.voice:state:v1',
          execute: async (client) => {
            const transcript = await ai.transcribe(update.botKey, audio, {
              baseLanguage: true,
              trace: {
                decisionId: update.decisionId,
                chatId,
                botKey: update.botKey,
                route: update.route
              }
            });
            if (!transcript) throw new Error('feedback_transcript_empty');
            await client.query(
              `INSERT INTO feedback (
                 chat_id, username, first_name, message_id, kind,
                 feedback_text, transcript, telegram_file_id, bot_key
               ) VALUES ($1, $2, $3, $4, 'voice', NULL, $5, $6, $7)`,
              [
                chatId,
                update.input.sender.username,
                update.input.sender.firstName,
                update.input.message.id,
                transcript,
                fileId,
                update.botKey
              ]
            );
            await client.query(
              `DELETE FROM pending_feedback WHERE chat_id = $1 AND bot_key = $2`,
              [chatId, update.botKey]
            );
            return { transcriptLength: transcript.length };
          }
        });
      } catch (error) {
        throw new BotRuntimeHandlerError('feedback_voice_save_failed', {
          retryable: true,
          cause: error
        });
      }
      const locale = localeRecord(getBotLocale(update.botKey));
      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'pending_feedback.voice:thanks:v1',
        text: localeText(locale, 'msg_feedback_thanks', 'Thanks, I received your feedback.')
      });
    }
  };
}
