export const BASE_LANGUAGE_CURRENCY_OPTIONS = Object.freeze({
  ar: Object.freeze(['USD', 'EUR']),
  de: Object.freeze(['EUR', 'CHF']),
  en: Object.freeze(['USD', 'GBP', 'EUR']),
  hi: Object.freeze(['INR', 'USD']),
  it: Object.freeze(['EUR', 'CHF']),
  tr: Object.freeze(['TRY', 'EUR']),
  uk: Object.freeze(['UAH', 'EUR'])
});

function normalizeBaseLanguage(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'ua' || value === 'uk-ua' || value === 'ua-ua') return 'uk';
  return value.slice(0, 16);
}

export function getBillingCurrenciesByBaseLanguage() {
  return BASE_LANGUAGE_CURRENCY_OPTIONS;
}

export function getBillingCurrenciesForBaseLanguage(baseLanguageRaw) {
  const baseLanguage = normalizeBaseLanguage(baseLanguageRaw);
  return baseLanguage ? [...(BASE_LANGUAGE_CURRENCY_OPTIONS[baseLanguage] || [])] : [];
}

export function buildBillingCurrencyCatalog(botCatalog = []) {
  const botsByBaseLanguage = {};

  for (const bot of botCatalog || []) {
    const baseLanguage = normalizeBaseLanguage(bot?.base_language);
    const botKey = (bot?.bot_key ?? '').toString().trim().toLowerCase();
    if (!baseLanguage || !botKey) continue;
    if (!botsByBaseLanguage[baseLanguage]) botsByBaseLanguage[baseLanguage] = [];
    botsByBaseLanguage[baseLanguage].push(botKey);
  }

  for (const botKeys of Object.values(botsByBaseLanguage)) {
    botKeys.sort((a, b) => a.localeCompare(b));
  }

  const baseLanguages = Object.keys(BASE_LANGUAGE_CURRENCY_OPTIONS)
    .sort()
    .map((baseLanguage) => ({
      base_language: baseLanguage,
      currencies: [...BASE_LANGUAGE_CURRENCY_OPTIONS[baseLanguage]],
      bot_keys: botsByBaseLanguage[baseLanguage] || []
    }));

  return {
    currencies_by_base_language: Object.fromEntries(
      Object.entries(BASE_LANGUAGE_CURRENCY_OPTIONS).map(([baseLanguage, currencies]) => [baseLanguage, [...currencies]])
    ),
    base_languages: baseLanguages
  };
}
