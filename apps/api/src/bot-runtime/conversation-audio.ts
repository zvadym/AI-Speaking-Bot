import type { Pool, PoolClient } from 'pg';
import type { PreparedUpdate } from './contracts.js';
import type { BotAiClient } from './bot-ai.js';
import type { MessagePresentationService, PresentationKey } from './message-presentation.js';
import { BotRuntimeHandlerError } from './handler-registry.js';
import { runBotUpdateEffect } from './effect-repository.js';
import type { PracticeQuotaGuard } from './practice-quota.js';

export async function recordVoiceUsage(
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

export async function attachConversationAudio({
  pool, update, ai, presentation, key, reply, quotaCheck, effectRunner = runBotUpdateEffect
}: {
  pool: Pool;
  update: PreparedUpdate;
  ai: BotAiClient;
  presentation: MessagePresentationService;
  key: PresentationKey;
  reply: string;
  quotaCheck: () => ReturnType<PracticeQuotaGuard>;
  effectRunner?: typeof runBotUpdateEffect;
}) {
  let audio: Buffer | undefined;
  if (!await presentation.hasVoice(key)) {
    const quota = await quotaCheck();
    if (!quota.allowed) return quota.outcome;
    try {
      audio = await ai.speech(update.botKey, reply, {
        decisionId: update.decisionId, chatId: key.chatId, botKey: update.botKey, route: update.route
      });
    } catch (error) {
      throw new BotRuntimeHandlerError('tts_failed', { retryable: true, cause: error });
    }
  }
  if (!await presentation.mutate(key, { audio, ensureVoice: true })) {
    throw new BotRuntimeHandlerError('presentation_missing', { retryable: true });
  }
  await effectRunner(pool, {
    decisionId: update.decisionId,
    stepKey: `${update.route}:tts-usage:v1`,
    execute: async (client) => {
      const seconds = estimatedSpeechSeconds(reply);
      await recordVoiceUsage(client, update, 'out', seconds);
      return { seconds };
    }
  });
  return null;
}

