import { pool } from '../db.js';
import { normalizeBotKey } from '../shared/normalization.js';
import {
  QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
  defaultRetryOptions,
  QUEUE_BROADCAST_RECIPIENT_SEND
} from '../queue.js';
import { env } from '../env.js';
import {
  sanitizeErrorText,
  sanitizeTelegramHtml,
  classifyPermanentTelegramFailure
} from '../shared/telegram-delivery.js';
import {
  BROADCAST_MESSAGE_KINDS,
  normalizeBroadcastMediaFileIds,
  normalizeBroadcastReplyMarkup,
  normalizeBroadcastFilters,
  broadcastAudienceParams,
  broadcastAudienceSql
} from '../shared/broadcast.js';
import {
  resolveTelegramBotToken,
  callTelegramApi,
  sendTelegramTextMessage,
  sendTelegramPhotoMessage,
  sendTelegramVideoMessage,
  updateUserDeliveryState
} from '../notifications/telegram.js';

async function refreshBroadcastCampaignStats(campaignId, { status = null, errorText = null, setFinishedAt = false } = {}) {
  await pool.query(
    `WITH stats AS (
       SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
       FROM broadcast_recipients
       WHERE campaign_id = $1
     )
     UPDATE broadcast_campaigns c
        SET total_recipients = s.total_count,
            sent_count = s.sent_count,
            failed_count = s.failed_count,
            status = COALESCE($2::text, c.status),
            error_text = CASE
              WHEN $3::text IS NOT NULL THEN $3::text
              ELSE c.error_text
            END,
            finished_at = CASE
              WHEN $4::boolean THEN NOW()
              ELSE c.finished_at
            END,
            updated_at = NOW()
       FROM stats s
      WHERE c.id = $1`,
    [campaignId, status, errorText, setFinishedAt]
  );
}

async function finalizeBroadcastCampaignIfDone(campaignId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
     FROM broadcast_recipients
     WHERE campaign_id = $1`,
    [campaignId]
  );

  const pendingCount = Number(rows[0]?.pending_count || 0);
  if (pendingCount > 0) {
    await refreshBroadcastCampaignStats(campaignId, { status: 'sending', setFinishedAt: false });
    return false;
  }

  await refreshBroadcastCampaignStats(campaignId, { status: 'completed', setFinishedAt: true });
  return true;
}

async function fetchBroadcastRecipientPayload(campaignId, chatId, botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  const { rows } = await pool.query(
    `SELECT
       c.id AS campaign_id,
       c.status AS campaign_status,
       c.message_text,
       c.message_kind,
       c.media_url,
       c.media_file_id,
       c.media_file_ids,
       c.reply_markup,
       r.chat_id,
       r.bot_key,
       r.status AS recipient_status,
       r.attempts
     FROM broadcast_campaigns c
     JOIN broadcast_recipients r
       ON r.campaign_id = c.id
     WHERE c.id = $1
       AND r.chat_id = $2
       AND r.bot_key = $3
     LIMIT 1`,
    [campaignId, chatId, botKey]
  );

  return rows[0] || null;
}

async function updateBroadcastRecipient(campaignId, chatId, botKeyRaw, { status, lastError = null, telegramMessageId = null }) {
  const botKey = normalizeBotKey(botKeyRaw);
  await pool.query(
    `UPDATE broadcast_recipients
        SET status = $4::text,
            attempts = attempts + 1,
            last_error = $5::text,
            sent_at = CASE
              WHEN $4::text = 'sent' THEN NOW()
              ELSE sent_at
            END,
            telegram_message_id = CASE
              WHEN $6::bigint IS NOT NULL THEN $6::bigint
              ELSE telegram_message_id
            END,
            updated_at = NOW()
      WHERE campaign_id = $1
        AND chat_id = $2
        AND bot_key = $3`,
    [campaignId, chatId, botKey, status, lastError, telegramMessageId]
  );
}

async function incrementBroadcastRecipientAttempt(campaignId, chatId, botKeyRaw, lastError) {
  const botKey = normalizeBotKey(botKeyRaw);
  await pool.query(
    `UPDATE broadcast_recipients
        SET attempts = attempts + 1,
            last_error = $4::text,
            updated_at = NOW()
      WHERE campaign_id = $1
        AND chat_id = $2
        AND bot_key = $3`,
    [campaignId, chatId, botKey, lastError]
  );
}

async function scanBroadcastRecipients(campaignId, limit, offset) {
  const { rows } = await pool.query(
    `SELECT chat_id, bot_key
       FROM broadcast_recipients
      WHERE campaign_id = $1
        AND status = 'pending'
      ORDER BY chat_id ASC, bot_key ASC
      LIMIT $2
      OFFSET $3`,
    [campaignId, limit, offset]
  );

  return rows.map((row) => ({
    chatId: Number(row.chat_id),
    botKey: normalizeBotKey(row.bot_key)
  }));
}

export async function enqueueBroadcastCampaign(boss, campaignId) {
  const id = Number(campaignId);
  if (!Number.isFinite(id) || id <= 0) return null;

  return boss.send(
    QUEUE_BROADCAST_CAMPAIGN_ENQUEUE,
    { campaignId: id },
    {
      ...defaultRetryOptions(),
      singletonKey: `broadcast_campaign:${id}`
    }
  );
}

async function enqueueBroadcastRecipientJob(boss, { campaignId, chatId, botKey }) {
  return boss.send(
    QUEUE_BROADCAST_RECIPIENT_SEND,
    { campaignId, chatId, botKey },
    {
      ...defaultRetryOptions(),
      singletonKey: `broadcast_recipient:${campaignId}:${botKey}:${chatId}`
    }
  );
}

export async function handleBroadcastCampaignEnqueue(jobs, boss) {
  for (const job of jobs) {
    const campaignId = Number(job.data?.campaignId);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;

    try {
      await pool.query(
        `UPDATE broadcast_campaigns
            SET status = 'sending',
                started_at = COALESCE(started_at, NOW()),
                finished_at = NULL,
                error_text = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status IN ('queued', 'sending')`,
        [campaignId]
      );

      let offset = 0;
      while (true) {
        const recipients = await scanBroadcastRecipients(campaignId, env.broadcastProcessBatchSize, offset);
        if (recipients.length === 0) break;

        for (const recipient of recipients) {
          await enqueueBroadcastRecipientJob(boss, {
            campaignId,
            chatId: recipient.chatId,
            botKey: recipient.botKey
          });
        }

        if (recipients.length < env.broadcastProcessBatchSize) break;
        offset += recipients.length;
      }

      await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
      await finalizeBroadcastCampaignIfDone(campaignId);

      console.log('broadcast-campaign-enqueue', {
        jobId: job.id,
        campaignId
      });
    } catch (error) {
      const lastError = sanitizeErrorText(error?.message || String(error)) || 'broadcast_enqueue_failed';
      await refreshBroadcastCampaignStats(campaignId, {
        status: 'failed',
        errorText: lastError,
        setFinishedAt: true
      });
      console.error('broadcast-campaign-enqueue:failed', {
        jobId: job.id,
        campaignId,
        error: lastError
      });
      throw error;
    }
  }
}

export async function handleBroadcastRecipientSend(jobs) {
  for (const job of jobs) {
    const campaignId = Number(job.data?.campaignId);
    const chatId = Number(job.data?.chatId);
    const botKey = normalizeBotKey(job.data?.botKey);
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue;
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) continue;

    const payload = await fetchBroadcastRecipientPayload(campaignId, chatId, botKey);
    if (!payload) continue;
    if (payload.recipient_status !== 'pending') continue;

    try {
      const messageText = (payload.message_text ?? '').toString();
      const messageKind = (payload.message_kind ?? 'text').toString().trim().toLowerCase();
      if (!BROADCAST_MESSAGE_KINDS.has(messageKind)) {
        throw new Error('bad_message_kind');
      }

      const mediaFileIdsByBot = normalizeBroadcastMediaFileIds(payload.media_file_ids);
      const mediaFileId = payload.media_file_id ? payload.media_file_id.toString() : null;
      const mediaUrl = payload.media_url ? payload.media_url.toString() : null;
      const replyMarkupResult = normalizeBroadcastReplyMarkup(payload.reply_markup);
      if (!replyMarkupResult.ok) {
        throw new Error(replyMarkupResult.error);
      }
      const replyMarkup = replyMarkupResult.replyMarkup;
      const telegramSafeText = sanitizeTelegramHtml(messageText);
      const mediaInput = mediaFileIdsByBot?.[botKey] || mediaFileId || mediaUrl || null;

      let telegramResult = null;
      if (messageKind === 'text') {
        telegramResult = await sendTelegramTextMessage(chatId, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      } else if (messageKind === 'photo') {
        if (!mediaInput) throw new Error('missing_media');
        telegramResult = await sendTelegramPhotoMessage(chatId, mediaInput, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      } else if (messageKind === 'video') {
        if (!mediaInput) throw new Error('missing_media');
        telegramResult = await sendTelegramVideoMessage(chatId, mediaInput, telegramSafeText, {
          botKey,
          parseMode: 'HTML',
          replyMarkup
        });
      }

      const messageId = Number(telegramResult?.message_id ?? 0);
      const telegramMessageId = Number.isFinite(messageId) && messageId > 0 ? messageId : null;

      await updateBroadcastRecipient(campaignId, chatId, botKey, {
        status: 'sent',
        telegramMessageId,
        lastError: null
      });
      await updateUserDeliveryState(chatId, { status: 'sent', lastError: null, inactiveReason: null, botKey });
      await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
      await finalizeBroadcastCampaignIfDone(campaignId);

      console.log('broadcast-recipient-send:sent', {
        jobId: job.id,
        campaignId,
        chatId,
        botKey,
        telegramMessageId
      });
    } catch (error) {
      const lastError = sanitizeErrorText(error?.message || String(error)) || 'telegram_send_failed';
      const inactiveReason = classifyPermanentTelegramFailure(error);
      const isFinalAttempt = Number(job.retryCount ?? 0) + 1 >= Number(job.retryLimit ?? env.jobRetryMaxAttempts);

      if (inactiveReason || isFinalAttempt) {
        await updateBroadcastRecipient(campaignId, chatId, botKey, {
          status: 'failed',
          lastError
        });
        await refreshBroadcastCampaignStats(campaignId, { status: 'sending' });
        await finalizeBroadcastCampaignIfDone(campaignId);
      } else {
        await incrementBroadcastRecipientAttempt(campaignId, chatId, botKey, lastError);
      }

      await updateUserDeliveryState(chatId, {
        status: 'failed',
        lastError,
        inactiveReason,
        botKey
      });

      console.warn('broadcast-recipient-send:failed', {
        jobId: job.id,
        campaignId,
        chatId,
        botKey,
        inactiveReason,
        isFinalAttempt,
        error: lastError
      });

      if (!inactiveReason && !isFinalAttempt) {
        throw error;
      }
    }

    if (env.broadcastPerMessageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.broadcastPerMessageDelayMs));
    }
  }
}

export async function getBroadcastAudiencePreview(filtersRaw, range, sampleLimit = 20) {
  const filters = normalizeBroadcastFilters(filtersRaw);
  const params = broadcastAudienceParams(filters, range);
  const countQuery = broadcastAudienceSql('COUNT(*)::int AS count');
  const sampleQuery = broadcastAudienceSql(
    `f.chat_id,
     f.username,
     f.first_name,
     f.bot_key,
     f.effective_tier,
     f.last_activity_at,
     f.streak_days,
     ROUND(f.usage_percent, 2)::numeric AS usage_percent,
     f.limit_reached`,
    'ORDER BY f.chat_id ASC, f.bot_key ASC LIMIT $13::int'
  );

  const [countRes, sampleRes] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(sampleQuery, [...params, sampleLimit])
  ]);

  return {
    filters,
    count: countRes.rows[0]?.count || 0,
    sample: sampleRes.rows || []
  };
}
