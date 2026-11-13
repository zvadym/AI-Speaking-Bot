import { loadBotConfigs } from '../bot-configs.js';
import { createPublicBotCatalogLookup } from '../shared/bot-catalog.js';
import { env } from '../env.js';
import { normalizeBotKey } from '../shared/normalization.js';

export const botConfigs = loadBotConfigs();

const botCatalog = createPublicBotCatalogLookup(botConfigs, env.telegramBotTokensByBotKey || {});

export const { metaForKey: publicBotMetaForKey } = botCatalog;

export function getBotLocale(botKeyRaw) {
  const botKey = normalizeBotKey(botKeyRaw);
  if (!botKey) return {};
  const config = botConfigs[botKey] || botConfigs[botKeyRaw] || {};
  return config.locale && typeof config.locale === 'object' ? config.locale : {};
}
