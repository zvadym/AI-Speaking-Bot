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
  const getBotLocale = (botKeyRaw) => {
    const botKey = botCatalog.metaForKey(botKeyRaw)?.bot_key || null;
    if (!botKey) return {};
    const config = botConfigs[botKey] || botConfigs[botKeyRaw] || {};
    return config?.locale && typeof config.locale === 'object' && !Array.isArray(config.locale)
      ? config.locale
      : {};
  };
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
    publicBotCatalog: botCatalog.catalog,
    publicBotCatalogByKey: botCatalog.byKey,
    publicBotMetaForKey: botCatalog.metaForKey,
    getBotLocale,
    telegramClient,
    deliveryState,
    actionEvents,
    apiBoss: overrides.apiBoss,
    ...overrides
  };
}
