import { env } from './env.js';
import { pool } from './db.js';
import { stripe } from './stripe.js';
import { loadBotConfigs } from './bot-configs.js';
import { createPublicBotCatalogLookup } from './shared/bot-catalog.js';
import { createTelegramClient, createTelegramDeliveryState } from './shared/telegram-delivery.js';
import { createActionEventService } from './shared/action-events.js';

export function createRuntimeDeps(overrides = {}) {
  const nextEnv = overrides.env || env;
  const nextPool = overrides.pool || pool;
  const nextStripe = overrides.stripe || stripe;
  const botConfigs = overrides.botConfigs || loadBotConfigs();
  const botCatalog = overrides.botCatalog || createPublicBotCatalogLookup(botConfigs, nextEnv.telegramBotTokensByBotKey || {});
  const telegramClient = overrides.telegramClient || createTelegramClient({
    env: nextEnv,
    fetchImpl: overrides.fetchImpl || fetch
  });
  const deliveryState = overrides.deliveryState || createTelegramDeliveryState({ pool: nextPool });
  const actionEvents = overrides.actionEvents || createActionEventService({ pool: nextPool });

  return {
    env: nextEnv,
    pool: nextPool,
    stripe: nextStripe,
    botConfigs,
    botCatalog,
    telegramClient,
    deliveryState,
    actionEvents,
    ...overrides
  };
}
