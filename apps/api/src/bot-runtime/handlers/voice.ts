import type { Pool, PoolClient } from 'pg';
import { sanitizeTelegramHtml } from '../../shared/telegram-delivery.js';
import type { BotAiClient } from '../bot-ai.js';
import type { PreparedUpdate } from '../contracts.js';
import { runBotUpdateEffect } from '../effect-repository.js';
import { BotRuntimeHandlerError, type BotHandler } from '../handler-registry.js';
import { runBotPipelineStage } from '../pipeline.js';
import {
  enforcePracticeQuota,
  type PracticeQuotaGuard
} from '../practice-quota.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import {
  deliverTelegramText,
  type TelegramTextClient
} from '../telegram-text-delivery.js';
import {
  deliverTelegramVoice,
  type TelegramVoiceClient
} from '../telegram-voice-delivery.js';
import {
  conversationReplyMarkup,
  executeConversation,
  type ConversationEffectResult
} from './conversation.js';

type Locale = Record<string, unknown>;

export interface VoiceTelegramClient extends TelegramTextClient, TelegramVoiceClient {
  downloadTelegramFile(fileId: string, options: { botKey: string }): Promise<Buffer>;
  callTelegramApi(
    botKey: string,
    method: string,
    body: Record<string, unknown>
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

async function recordVoiceUsage(
  client: PoolClient,
  update: PreparedUpdate,
  direction: 'in' | 'out',
  seconds: number
): Promise<void> {
  const chatId = update.input.chatId as number;
  const safeSeconds = Math.max(0, Math.round(seconds));
  await client.query(
    `INSERT INTO usage_hourly (
       chat_id, bot_key, hour_start, in_voice_seconds, out_voice_seconds,
       in_events, out_events, updated_at
     ) VALUES (
       $1, $2, date_trunc('hour', NOW()),
       CASE WHEN $3 = 'in' THEN $4 ELSE 0 END,
       CASE WHEN $3 = 'out' THEN $4 ELSE 0 END,
       CASE WHEN $3 = 'in' THEN 1 ELSE 0 END,
       CASE WHEN $3 = 'out' THEN 1 ELSE 0 END,
       NOW()
     )
     ON CONFLICT (chat_id, bot_key, hour_start) DO UPDATE SET
       in_voice_seconds = usage_hourly.in_voice_seconds + EXCLUDED.in_voice_seconds,
       out_voice_seconds = usage_hourly.out_voice_seconds + EXCLUDED.out_voice_seconds,
       in_events = usage_hourly.in_events + EXCLUDED.in_events,
       out_events = usage_hourly.out_events + EXCLUDED.out_events,
       updated_at = NOW()`,
    [chatId, update.botKey, direction, safeSeconds]
  );
  await client.query(
    `INSERT INTO voice_usage_events (chat_id, bot_key, direction, seconds, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      chatId,
      update.botKey,
      direction,
      safeSeconds,
      direction === 'in' ? 'telegram_voice_duration' : 'tts_estimate'
    ]
  );
}

function estimatedSpeechSeconds(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return Math.min(Math.max(Math.ceil(words / 2.5), 1), 60);
}

export function createVoiceConversationHandler({
  pool,
  getBotLocale,
  telegramClient,
  ai,
  webappUrl,
  quotaGuard = enforcePracticeQuota,
  effectRunner = runBotUpdateEffect,
  textDeliverer = deliverTelegramText,
  voiceDeliverer = deliverTelegramVoice
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: VoiceTelegramClient;
  ai: BotAiClient;
  webappUrl: string;
  quotaGuard?: PracticeQuotaGuard;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
  voiceDeliverer?: typeof deliverTelegramVoice;
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
      if (duration > 25) {
        return textDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:too-long:v1',
          text: localeText(locale, 'msg_too_long', 'Please keep voice messages under 25 seconds.')
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

      let result: VoiceConversationResult;
      result = await runBotPipelineStage(pipeline, 'conversation.generate', async () => {
        await Promise.allSettled([
          telegramClient.callTelegramApi(update.botKey, 'sendChatAction', {
            chat_id: chatId,
            action: 'typing'
          })
        ]);
        let audio: Buffer;
        try {
          audio = await telegramClient.downloadTelegramFile(fileId, { botKey: update.botKey });
        } catch (error) {
          throw new BotRuntimeHandlerError('telegram_voice_download_failed', {
            retryable: true,
            cause: error
          });
        }

        try {
          const effect = await effectRunner(pool, {
            decisionId: update.decisionId,
            stepKey: 'message.voice:conversation:v1',
            execute: async (client) => {
              const transcript = await ai.transcribe(update.botKey, audio, {
                trace: {
                  decisionId: update.decisionId,
                  chatId,
                  botKey: update.botKey,
                  route: update.route
                }
              });
              if (!transcript) throw new Error('voice_transcript_empty');
              const conversation = await executeConversation(
                client,
                update,
                ai,
                transcript,
                'voice'
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
        }
      });

      await textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'message.voice:transcript:v1',
        text: `${localeText(locale, 'user_text_prefix_multiline', 'You said:\n')}${result.transcript}`,
        replyMarkup: {
          inline_keyboard: [[{
            text: localeText(locale, 'btn_translation', 'Translation'),
            callback_data: 'trv:1'
          }]]
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

      if (String(result.replyMode).toLowerCase() === 'voice') {
        const ttsQuota = await quotaGuard({
          pool,
          update,
          getBotLocale,
          telegramClient,
          webappUrl,
          beforeBlockedDelivery: () => textDeliverer({
            pool,
            update,
            telegramClient,
            stepKey: 'message.voice:reply:v1',
            text: reply,
            replyMarkup: conversationReplyMarkup(assistantMessageId, locale)
          })
        });
        if (!ttsQuota.allowed) return ttsQuota.outcome;

        let speech: Buffer;
        try {
          speech = await ai.speech(update.botKey, reply, {
            decisionId: update.decisionId,
            chatId,
            botKey: update.botKey,
            route: update.route
          });
        } catch (error) {
          throw new BotRuntimeHandlerError('tts_failed', { retryable: true, cause: error });
        }
        await voiceDeliverer({
          pool,
          update,
          telegramClient,
          stepKey: 'message.voice:tts:v1',
          buffer: speech
        });
        await effectRunner(pool, {
          decisionId: update.decisionId,
          stepKey: 'message.voice:tts-usage:v1',
          execute: async (client) => {
            const seconds = estimatedSpeechSeconds(reply);
            await recordVoiceUsage(client, update, 'out', seconds);
            return { seconds };
          }
        });
      }

      return textDeliverer({
        pool,
        update,
        telegramClient,
        stepKey: 'message.voice:reply:v1',
        text: String(result.replyMode).toLowerCase() === 'voice'
          ? `${localeText(locale, 'voice_reply_prefix', '')}${reply}`
          : reply,
        replyMarkup: conversationReplyMarkup(assistantMessageId, locale)
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
