import express from 'express';
import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { normalizeBotKey } from '../shared/normalization.js';
import { captureException } from '../sentry.js';
import { ingestBotUpdate, BotUpdateIngestionError } from '../bot-runtime/ingestion-service.js';
import { prepareBotUpdate } from '../bot-runtime/prepare-update-service.js';
import { normalizeTelegramUpdate } from '../bot-runtime/telegram-update.js';
import { bootstrapTelegramUser } from '../bot-runtime/user-bootstrap.js';
import {
  deriveTelegramWebhookSecret,
  verifyTelegramWebhookSecret
} from '../bot-runtime/webhook-secret.js';
import { isBotRuntimeRouteEnabled, type BotRuntimeRouteFlags } from '../bot-runtime/route-flags.js';
import { createDirectSettingsHandler } from '../bot-runtime/direct-settings.js';
import type { TopicMenuHelpers } from '../bot-runtime/handlers/topic-menu.js';
import { startImmediateTelegramAck } from '../bot-runtime/immediate-telegram-ack.js';

interface TelegramWebhookContext {
  pool: Pool;
  apiBoss: {
    send(name: string, data: object, options: Record<string, unknown>): Promise<string | null>;
  } | null;
  env: {
    botRuntimeRouteFlags: BotRuntimeRouteFlags;
    botImmediateAckEnabledBotKeys: ReadonlySet<string>;
    botOnboardingV2EnabledBotKeys?: ReadonlySet<string>;
    internalApiSecret: string;
    jwtSecret: string;
    telegramBotTokensByBotKey: Record<string, string>;
  };
  telegramClient: {
    callTelegramApi(
      botKey: string,
      method: string,
      body: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ): Promise<unknown>;
  };
  publicBotMetaForKey(botKey: unknown): { bot_key?: unknown } | null;
  getBotLocale(botKey: string): unknown;
}

export function createTelegramWebhookRouter(ctx: TelegramWebhookContext, helpers?: TopicMenuHelpers) {
  const router = express.Router();
  const handleSettings = createDirectSettingsHandler({...ctx,helpers});

  router.post('/telegram/webhook/:botKey', async (req, res) => {
    const receivedAtMs = performance.now();
    const botKey = normalizeBotKey(req.params.botKey);
    const botToken = botKey ? String(ctx.env.telegramBotTokensByBotKey[botKey] || '') : '';
    const signingSecret = String(ctx.env.internalApiSecret || ctx.env.jwtSecret || '');
    if (!botKey || !botToken || !ctx.publicBotMetaForKey(botKey)) {
      return res.status(404).json({ error: 'bot_not_found' });
    }
    let expectedSecret: string;
    try {
      expectedSecret = deriveTelegramWebhookSecret({ botKey, botToken, signingSecret });
    } catch {
      return res.status(503).json({ error: 'webhook_not_configured' });
    }
    if (!verifyTelegramWebhookSecret(
      req.get('x-telegram-bot-api-secret-token'),
      expectedSecret
    )) {
      return res.status(401).json({ error: 'invalid_webhook_secret' });
    }

    let updateId: number | null = null;
    try {
      const input = normalizeTelegramUpdate(req.body);
      updateId = input.updateId;
      if (isBotRuntimeRouteEnabled(ctx.env.botRuntimeRouteFlags, botKey, 'callback.settings') &&
          await handleSettings(botKey,input)) {
        return res.status(200).json({ok:true});
      }
      startImmediateTelegramAck({
        telegramClient: ctx.telegramClient,
        enabledBotKeys: ctx.env.botImmediateAckEnabledBotKeys,
        botKey,
        input,
        receivedAtMs
      });
      await bootstrapTelegramUser(ctx.pool, {
        botKey,
        input,
        onboardingEnabledBotKeys: ctx.env.botOnboardingV2EnabledBotKeys || new Set<string>()
      });
      const contract = await prepareBotUpdate(ctx, {
        botKey,
        telegramUpdate: req.body
      });
      const result = await ingestBotUpdate(ctx, contract);
      if (!result.accepted) {
        console.warn('telegram-webhook:not-accepted', {
          botKey,
          updateId,
          route: contract.route,
          error: result.error
        });
        return res.status(503).json({ ok: false, error: result.error });
      }
      console.info('telegram-webhook:accepted', {
        botKey,
        updateId,
        route: contract.route,
        duplicate: result.duplicate
      });
      return res.status(200).json({ ok: true });
    } catch (error) {
      const invalid = error instanceof BotUpdateIngestionError && error.code === 'invalid_contract';
      console.error('telegram-webhook:failed', {
        botKey,
        updateId,
        error: error instanceof Error ? error.message : String(error)
      });
      captureException(error, {
        tags: { route: 'telegram-webhook', bot_key: botKey },
        extra: { updateId }
      });
      return res.status(invalid ? 400 : 503).json({
        ok: false,
        error: invalid ? 'invalid_update' : 'webhook_processing_failed'
      });
    }
  });

  return router;
}
