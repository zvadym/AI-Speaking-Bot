import { randomUUID } from 'crypto';
import { Router } from 'express';
import {
  enqueueDiscordEventNotificationJob,
  enqueueLoaderRotateJob,
  enqueueLoaderTimeoutCleanupJob,
  sendIdiomPracticeMorePhrase
} from '../jobs.js';
import {
  BotRuntimeInputError,
  PREPARED_UPDATE_CONTRACT_VERSION
} from '../bot-runtime/contracts.js';
import { prepareBotUpdate } from '../bot-runtime/prepare-update-service.js';
import { normalizeBotKey } from '../shared/normalization.js';
import { createRequireInternalApi } from '../middleware/internal-api.js';
import { captureException } from '../sentry.js';

function logPrepareUpdateTelemetry({ startedAtMs, botKey, route = null, errorCode = null }) {
  console.info('internal-bot-prepare-update', {
    contractVersion: PREPARED_UPDATE_CONTRACT_VERSION,
    botKey: botKey || null,
    route,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    errorCode
  });
}

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
      const catalogTopic = catalog.find((item) => item.topic_id === String(state.topic_template_id || '').trim().toLowerCase()) || null;
      const activeTopic = state.topic_enabled
        ? { ...(catalogTopic || {}), ...(pack || {}) }
        : null;
      const topicTitle = activeTopic ? helpers.formatTopicMenuLabel(activeTopic, locale, { userTier }) : '';
      const currentPrefix = String(locale.topic_menu_current_prefix || 'Current topic: ').trim() || 'Current topic: ';
      const currentNone = String(locale.topic_menu_current_none || 'Current topic: none active.').trim() || 'Current topic: none active.';
      const bodyText = [
        String(locale.topic_menu_title || 'Choose a conversation topic 👇').trim() || 'Choose a conversation topic 👇',
        '',
        topicTitle ? `${currentPrefix}${topicTitle}` : currentNone
      ].join('\n');

      const telegramResult = await helpers.sendTelegramTextMessage(chatId, bodyText, {
        botKey,
        replyMarkup: helpers.buildTopicMenuReplyMarkup(catalog, locale, { userTier })
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

  router.post('/internal/bot/prepare-update', requireInternalApi, async (req, res) => {
    const startedAtMs = Date.now();
    const rawBotKey = req.body?.bot_key ?? req.body?.botKey;
    const botKey = normalizeBotKey(rawBotKey);
    const telegramUpdate = req.body?.telegram_update ?? req.body?.telegramUpdate ?? req.body?.update;

    if (!telegramUpdate || typeof telegramUpdate !== 'object' || Array.isArray(telegramUpdate)) {
      logPrepareUpdateTelemetry({ startedAtMs, botKey, errorCode: 'invalid_update' });
      return res.status(400).json({ error: 'invalid_update' });
    }

    try {
      const prepared = await prepareBotUpdate(ctx, { botKey: rawBotKey, telegramUpdate });
      logPrepareUpdateTelemetry({
        startedAtMs,
        botKey: prepared.botKey,
        route: prepared.route
      });
      return res.json(prepared);
    } catch (error) {
      if (error instanceof BotRuntimeInputError) {
        logPrepareUpdateTelemetry({ startedAtMs, botKey, errorCode: error.code });
        return res.status(400).json({ error: error.code });
      }

      logPrepareUpdateTelemetry({ startedAtMs, botKey, errorCode: 'prepare_update_failed' });
      console.error('internal-bot-prepare-update failed', {
        botKey,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-bot-prepare-update' },
        extra: { botKey }
      });
      return res.status(500).json({ error: 'prepare_update_failed' });
    }
  });

  router.post('/internal/idiom-practice/more', requireInternalApi, async (req, res) => {
    const chatId = Number(req.body?.chat_id);
    const botKey = normalizeBotKey(req.body?.bot_key);
    const scheduleKey = (req.body?.schedule_key ?? '').toString().trim();
    const callbackQueryId = (req.body?.callback_query_id ?? '').toString().trim();
    const sourceMessageId = Number(req.body?.source_message_id);

    if (!Number.isFinite(chatId) || chatId <= 0 || !botKey || !scheduleKey || !callbackQueryId) {
      return res.status(400).json({ error: 'bad_request' });
    }

    try {
      const result = await sendIdiomPracticeMorePhrase({
        chatId,
        botKey,
        scheduleKey,
        callbackQueryId,
        sourceMessageId
      });
      return res.json(result);
    } catch (error) {
      console.error('internal-idiom-practice-more failed', {
        chatId,
        botKey,
        scheduleKey,
        callbackQueryId,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-idiom-practice-more' },
        extra: { chatId, botKey, scheduleKey, callbackQueryId }
      });

      const errorCode = String(error?.code || '').trim();
      if (errorCode === 'bad_request') {
        return res.status(400).json({ error: 'bad_request' });
      }
      if (
        errorCode === 'idiom_phrase_build_failed'
        || errorCode === 'telegram_send_failed'
      ) {
        return res.status(502).json({
          error: errorCode || 'request_failed',
          detail: error?.detail || error?.message || errorCode || 'request_failed'
        });
      }
      return res.status(500).json({ error: 'idiom_practice_more_failed' });
    }
  });

  router.post('/internal/notifications/n8n-error', requireInternalApi, async (req, res) => {
    const executionId = (req.body?.execution_id ?? req.body?.executionId ?? '').toString().trim();
    const workflowId = (req.body?.workflow_id ?? req.body?.workflowId ?? '').toString().trim();
    const workflowName = (req.body?.workflow_name ?? req.body?.workflowName ?? '').toString().trim();
    const errorMessage = (req.body?.error_message ?? req.body?.errorMessage ?? req.body?.message ?? '').toString().trim();
    const mode = (req.body?.mode ?? '').toString().trim();
    const lastNode = (req.body?.last_node ?? req.body?.lastNode ?? '').toString().trim();
    const url = (req.body?.url ?? req.body?.execution_url ?? req.body?.executionUrl ?? '').toString().trim();
    const botKey = normalizeBotKey(req.body?.bot_key ?? req.body?.botKey ?? null);

    if (!workflowName && !workflowId) {
      return res.status(400).json({ error: 'workflow_required' });
    }
    if (!errorMessage) {
      return res.status(400).json({ error: 'error_message_required' });
    }
    if (!ctx.apiBoss || !ctx.env.discordEventsWebhookUrl) {
      return res.status(202).json({ ok: true, queued: false, reason: 'discord_events_not_configured' });
    }

    try {
      const singletonKey = executionId
        ? `discord_event:n8n_execution_error:${executionId}`
        : undefined;
      await enqueueDiscordEventNotificationJob(
        ctx.apiBoss,
        {
          type: 'n8n_execution_error',
          execution_id: executionId || null,
          workflow_id: workflowId || null,
          workflow_name: workflowName || null,
          error_message: errorMessage,
          mode: mode || null,
          last_node: lastNode || null,
          url: url || null,
          bot_key: botKey || null
        },
        { singletonKey }
      );
      return res.status(202).json({ ok: true, queued: true });
    } catch (error) {
      console.error('internal-notifications-n8n-error failed', {
        executionId,
        workflowId,
        workflowName,
        error: error?.message || String(error)
      });
      captureException(error, {
        tags: { route: 'internal-notifications-n8n-error' },
        extra: { executionId, workflowId, workflowName }
      });
      return res.status(500).json({ error: 'notification_enqueue_failed' });
    }
  });

  return router;
}
