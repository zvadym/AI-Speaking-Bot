import { defaultRetryOptions, QUEUE_DISCORD_EVENT_SEND } from '../queue.js';
import { sendDiscordEventNotification } from '../discord-events.js';
import { env } from '../env.js';
import { publicBotMetaForKey } from './bot-context.js';

const DISCORD_EVENT_TYPES = new Set(['new_paid_user', 'user_milestone', 'user_feedback']);

export async function enqueueDiscordEventNotificationJob(boss, event, { singletonKey } = {}) {
  if (!boss) return null;

  const type = String(event?.type || '').trim();
  if (!DISCORD_EVENT_TYPES.has(type)) return null;

  const sendOptions = {
    ...defaultRetryOptions()
  };
  if (singletonKey) {
    sendOptions.singletonKey = singletonKey;
  }

  return boss.send(QUEUE_DISCORD_EVENT_SEND, { ...event, type }, sendOptions);
}

export async function handleDiscordEventSend(jobs) {
  for (const job of jobs) {
    const event = job.data || {};
    const type = String(event?.type || '').trim();
    if (!DISCORD_EVENT_TYPES.has(type)) {
      continue;
    }

    const result = await sendDiscordEventNotification({
      webhookUrl: env.discordEventsWebhookUrl,
      event,
      botMetaForKey: publicBotMetaForKey
    });

    console.log('discord-event-send:sent', {
      jobId: job.id,
      type,
      executionId: event.execution_id || null,
      chatId: Number(event.chat_id || 0) || null,
      result: result?.ok === true ? 'ok' : 'skipped'
    });
  }
}
