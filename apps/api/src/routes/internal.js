import { randomUUID } from 'crypto';
import { Router } from 'express';
import {
  enqueueLoaderRotateJob,
  enqueueLoaderTimeoutCleanupJob
} from '../jobs.js';
import { normalizeBotKey } from '../shared/normalization.js';
import { createRequireInternalApi } from '../middleware/internal-api.js';
import { captureException } from '../sentry.js';

export function createInternalRouter(ctx, helpers) {
  const router = Router();
  const requireInternalApi = createRequireInternalApi(ctx.env);

  router.post('/internal/loader/start', requireInternalApi, async (req, res) => {
    const chatId = Number(req.body?.chat_id);
    const botKey = normalizeBotKey(req.body?.bot_key);
    const waitingText = helpers.normalizeLoaderWaitingText(req.body?.waiting_text);
    const messages = helpers.normalizeLoaderMessages(req.body?.messages);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !waitingText) {
      return res.status(400).json({ error: 'bad_request' });
    }

    try {
      await helpers.stopAndDeleteLoader(chatId, botKey);

      const telegramResult = await helpers.sendTelegramTextMessage(chatId, waitingText, { botKey });
      const messageId = helpers.normalizeLoaderMessageId(telegramResult?.message_id);
      if (!messageId) {
        return res.status(502).json({ error: 'telegram_message_missing' });
      }

      const sessionId = randomUUID();

      try {
        await helpers.upsertLoaderState({ chatId, botKey, sessionId, messageId });
        await enqueueLoaderRotateJob(ctx.apiBoss, {
          chatId,
          botKey,
          sessionId,
          waitingText,
          messages
        });
        await enqueueLoaderTimeoutCleanupJob(ctx.apiBoss, { chatId, botKey, sessionId });
      } catch (error) {
        try {
          await ctx.telegramClient.deleteTelegramMessage(chatId, messageId, { botKey });
        } catch (cleanupError) {
          const cleanupMessage = (cleanupError?.telegramDescription || cleanupError?.message || '').toString().toLowerCase();
          if (
            !cleanupMessage.includes('message to delete not found') &&
            !cleanupMessage.includes('message identifier is not specified')
          ) {
            console.warn('loader-start:rollback-delete-failed', {
              chatId,
              botKey,
              messageId,
              error: cleanupError?.telegramDescription || cleanupError?.message || String(cleanupError)
            });
          }
        }
        await helpers.stopAndDeleteLoader(chatId, botKey, sessionId);
        throw error;
      }

      return res.json({
        ok: true,
        session_id: sessionId,
        message_id: messageId
      });
    } catch (error) {
      console.error('internal-loader-start failed', {
        chatId,
        botKey,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-loader-start' },
        extra: { chatId, botKey }
      });
      return res.status(500).json({ error: 'loader_start_failed' });
    }
  });

  router.post('/internal/loader/stop', requireInternalApi, async (req, res) => {
    const chatId = Number(req.body?.chat_id);
    const botKey = normalizeBotKey(req.body?.bot_key);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) {
      return res.status(400).json({ error: 'bad_request' });
    }

    try {
      await helpers.stopAndDeleteLoader(chatId, botKey);
      return res.json({ ok: true });
    } catch (error) {
      console.error('internal-loader-stop failed', {
        chatId,
        botKey,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-loader-stop' },
        extra: { chatId, botKey }
      });
      return res.status(500).json({ error: 'loader_stop_failed' });
    }
  });

  router.post('/internal/topics/menu', requireInternalApi, async (req, res) => {
    const chatId = Number(req.body?.chat_id);
    const botKey = normalizeBotKey(req.body?.bot_key);
    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey) {
      return res.status(400).json({ error: 'bad_request' });
    }

    try {
      const locale = helpers.getBotLocale(botKey);
      const [userTier, stateResult] = await Promise.all([
        helpers.fetchEffectiveTierForChat(chatId),
        ctx.pool.query(
          `SELECT topic_enabled, topic_template_id, topic_pack_json
           FROM user_bots
           WHERE chat_id = $1
             AND bot_key = $2
           LIMIT 1`,
          [chatId, botKey]
        )
      ]);
      const catalog = await helpers.fetchTopicCatalogRows(botKey, { userTier });
      const state = stateResult.rows[0] || {};
      const pack = helpers.normalizeTopicPackValue(state.topic_pack_json);
      const topicTitle = state.topic_enabled && pack && typeof pack.title_base === 'string'
        ? pack.title_base.trim()
        : '';
      const currentPrefix = String(locale.topic_menu_current_prefix || 'Current topic: ').trim() || 'Current topic: ';
      const currentNone = String(locale.topic_menu_current_none || 'Current topic: none active.').trim() || 'Current topic: none active.';
      const bodyText = [
        String(locale.topic_menu_title || 'Choose a conversation topic 👇').trim() || 'Choose a conversation topic 👇',
        '',
        topicTitle ? `${currentPrefix}${topicTitle}` : currentNone
      ].join('\n');

      const telegramResult = await helpers.sendTelegramTextMessage(chatId, bodyText, {
        botKey,
        replyMarkup: helpers.buildTopicMenuReplyMarkup(catalog, locale)
      });

      return res.json({
        ok: true,
        message_id: Number(telegramResult?.message_id || 0) || null,
        count: catalog.length
      });
    } catch (error) {
      console.error('internal-topics-menu failed', {
        chatId,
        botKey,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-topics-menu' },
        extra: { chatId, botKey }
      });
      return res.status(500).json({ error: 'topic_menu_failed' });
    }
  });

  return router;
}
