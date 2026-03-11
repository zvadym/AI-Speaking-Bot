import { normalizeBotKey, normalizeLanguageCode, normalizeOptionalText, normalizeStringArray } from './normalization.js';

export function buildPublicBotCatalog(configMap = {}, tokenMap = {}) {
  const keys = new Set([
    ...Object.keys(configMap || {}),
    ...Object.keys(tokenMap || {})
  ]);

  const catalog = [];
  for (const rawKey of keys) {
    const botKey = normalizeBotKey(rawKey);
    if (!botKey) continue;

    const config = configMap?.[botKey] || configMap?.[rawKey] || {};
    const [fromBase, fromLearning] = botKey.split('-');
    const baseLanguage = normalizeLanguageCode(config.base_language || fromBase || '');
    const learningLanguage = normalizeLanguageCode(config.learning_language || fromLearning || '');
    const botNameRaw = (config.bot_name || '').toString().trim();
    const telegramUrlRaw = (config.telegram_url || '').toString().trim();
    const teacherAvatarEmoji = normalizeOptionalText(config.teacher_avatar_emoji, 8);
    const teacherTaglineUk = normalizeOptionalText(config.teacher_tagline_uk, 220);
    const teacherTaglineEn = normalizeOptionalText(config.teacher_tagline_en, 220);
    const teacherTaglineIt = normalizeOptionalText(config.teacher_tagline_it, 220) || teacherTaglineEn || teacherTaglineUk;
    const teacherStyleTags = normalizeStringArray(config.teacher_style_tags, { maxItems: 12, maxItemLen: 32 });

    catalog.push({
      bot_key: botKey,
      base_language: baseLanguage || null,
      learning_language: learningLanguage || null,
      target_lang: learningLanguage || null,
      bot_name: botNameRaw || null,
      telegram_url: telegramUrlRaw || null,
      teacher_avatar_emoji: teacherAvatarEmoji,
      teacher_tagline_uk: teacherTaglineUk,
      teacher_tagline_en: teacherTaglineEn,
      teacher_tagline_it: teacherTaglineIt,
      teacher_style_tags: teacherStyleTags
    });
  }

  catalog.sort((a, b) => {
    const langA = a.learning_language || '';
    const langB = b.learning_language || '';
    if (langA !== langB) return langA.localeCompare(langB);

    const nameA = a.bot_name || a.bot_key;
    const nameB = b.bot_name || b.bot_key;
    if (nameA !== nameB) return nameA.localeCompare(nameB);

    return a.bot_key.localeCompare(b.bot_key);
  });

  return catalog;
}

export function createPublicBotCatalogLookup(configMap = {}, tokenMap = {}) {
  const catalog = buildPublicBotCatalog(configMap, tokenMap);
  const byKey = new Map(catalog.map((bot) => [bot.bot_key, bot]));

  return {
    catalog,
    byKey,
    metaForKey(botKeyRaw) {
      const botKey = normalizeBotKey(botKeyRaw);
      if (!botKey) return null;
      return byKey.get(botKey) || null;
    }
  };
}
