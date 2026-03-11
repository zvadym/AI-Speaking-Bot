export const BASE_LANGUAGE_CURRENCY_OPTIONS = Object.freeze({
  ar: Object.freeze(['USD', 'EUR']),
  de: Object.freeze(['EUR', 'CHF']),
  en: Object.freeze(['USD', 'GBP', 'EUR']),
  hi: Object.freeze(['INR', 'USD']),
  it: Object.freeze(['EUR', 'CHF']),
  tr: Object.freeze(['TRY', 'EUR']),
  uk: Object.freeze(['UAH', 'EUR', 'PLN'])
});

export const CURRENCY_DISPLAY_CONFIG = Object.freeze({
  USD: Object.freeze({ name: 'US Dollar', symbol: '$', locale: 'en-US', minor_unit: 2 }),
  GBP: Object.freeze({ name: 'British Pound', symbol: '£', locale: 'en-GB', minor_unit: 2 }),
  EUR: Object.freeze({ name: 'Euro', symbol: '€', locale: 'de-DE', minor_unit: 2 }),
  CHF: Object.freeze({ name: 'Swiss Franc', symbol: 'CHF', locale: 'de-CH', minor_unit: 2 }),
  INR: Object.freeze({ name: 'Indian Rupee', symbol: '₹', locale: 'en-IN', minor_unit: 2 }),
  TRY: Object.freeze({ name: 'Turkish Lira', symbol: '₺', locale: 'tr-TR', minor_unit: 2 }),
  UAH: Object.freeze({ name: 'Ukrainian Hryvnia', symbol: '₴', locale: 'uk-UA', minor_unit: 2 }),
  PLN: Object.freeze({ name: 'Polish Zloty', symbol: 'zł', locale: 'pl-PL', minor_unit: 2 })
});

function normalizeBaseLanguage(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'ua' || value === 'uk-ua' || value === 'ua-ua') return 'uk';
  return value.slice(0, 16);
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildCurrencyFormattingMeta(code) {
  const currencyCode = String(code || '').trim().toUpperCase();
  const config = CURRENCY_DISPLAY_CONFIG[currencyCode];
  if (!config) return null;

  const sampleValue = 1234567.89;
  const formatter = new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: config.minor_unit,
    maximumFractionDigits: config.minor_unit
  });

  const parts = formatter.formatToParts(sampleValue);
  const currencyIndex = parts.findIndex((part) => part.type === 'currency');
  const integerIndex = parts.findIndex((part) => part.type === 'integer');
  const decimalPart = parts.find((part) => part.type === 'decimal');
  const groupPart = parts.find((part) => part.type === 'group');
  const decimalSeparator = decimalPart?.value || '.';
  const groupSeparator = groupPart?.value || ',';
  const symbolPosition =
    currencyIndex >= 0 && integerIndex >= 0 && currencyIndex < integerIndex ? 'prefix' : 'suffix';

  return Object.freeze({
    code: currencyCode,
    name: config.name,
    symbol: config.symbol,
    locale: config.locale,
    minor_unit: config.minor_unit,
    symbol_position: symbolPosition,
    decimal_separator: decimalSeparator,
    group_separator: groupSeparator,
    example_format: formatter.format(sampleValue)
  });
}

const CURRENCY_DETAILS = Object.freeze(
  Object.fromEntries(
    Object.keys(CURRENCY_DISPLAY_CONFIG).map((code) => [code, buildCurrencyFormattingMeta(code)])
  )
);

export function getBillingCurrenciesByBaseLanguage() {
  return BASE_LANGUAGE_CURRENCY_OPTIONS;
}

export function getBillingCurrenciesForBaseLanguage(baseLanguageRaw) {
  const baseLanguage = normalizeBaseLanguage(baseLanguageRaw);
  return baseLanguage ? [...(BASE_LANGUAGE_CURRENCY_OPTIONS[baseLanguage] || [])] : [];
}

export function getBillingCurrencyDetails() {
  return CURRENCY_DETAILS;
}

export function buildBillingCurrencyCatalog(botCatalog = [], { baseLanguage: baseLanguageRaw = null } = {}) {
  const requestedBaseLanguage = normalizeBaseLanguage(baseLanguageRaw);
  const botsByBaseLanguage = {};
  const baseLanguagesByCurrency = {};

  for (const bot of botCatalog || []) {
    const baseLanguage = normalizeBaseLanguage(bot?.base_language);
    const botKey = (bot?.bot_key ?? '').toString().trim().toLowerCase();
    if (!baseLanguage || !botKey) continue;
    if (!botsByBaseLanguage[baseLanguage]) botsByBaseLanguage[baseLanguage] = [];
    botsByBaseLanguage[baseLanguage].push(botKey);
  }

  for (const [baseLanguage, currencies] of Object.entries(BASE_LANGUAGE_CURRENCY_OPTIONS)) {
    for (const currency of currencies) {
      if (!baseLanguagesByCurrency[currency]) baseLanguagesByCurrency[currency] = [];
      baseLanguagesByCurrency[currency].push(baseLanguage);
    }
  }

  for (const botKeys of Object.values(botsByBaseLanguage)) {
    botKeys.sort((a, b) => a.localeCompare(b));
  }

  const baseLanguages = Object.keys(BASE_LANGUAGE_CURRENCY_OPTIONS)
    .sort()
    .map((baseLanguage) => ({
      base_language: baseLanguage,
      currencies: [...BASE_LANGUAGE_CURRENCY_OPTIONS[baseLanguage]],
      currency_details: BASE_LANGUAGE_CURRENCY_OPTIONS[baseLanguage]
        .map((currency) => CURRENCY_DETAILS[currency])
        .filter(Boolean),
      bot_keys: botsByBaseLanguage[baseLanguage] || []
    }));

  let currencyOptions = Object.keys(CURRENCY_DETAILS)
    .sort((a, b) => {
      const usageDiff = (baseLanguagesByCurrency[b]?.length || 0) - (baseLanguagesByCurrency[a]?.length || 0);
      if (usageDiff !== 0) return usageDiff;
      return a.localeCompare(b);
    })
    .map((currency) => ({
      ...CURRENCY_DETAILS[currency],
      base_languages: uniqueSorted(baseLanguagesByCurrency[currency] || [])
    }));

  if (requestedBaseLanguage) {
    const allowedCurrencies = new Set(BASE_LANGUAGE_CURRENCY_OPTIONS[requestedBaseLanguage] || []);
    currencyOptions = currencyOptions.filter((item) => allowedCurrencies.has(item.code));
  }

  const currenciesByBaseLanguage = requestedBaseLanguage
    ? { [requestedBaseLanguage]: [...(BASE_LANGUAGE_CURRENCY_OPTIONS[requestedBaseLanguage] || [])] }
    : Object.fromEntries(
        Object.entries(BASE_LANGUAGE_CURRENCY_OPTIONS).map(([baseLanguage, currencies]) => [baseLanguage, [...currencies]])
      );

  const currencyDetails = Object.fromEntries(
    Object.entries(CURRENCY_DETAILS)
      .filter(([currency]) => {
        if (!requestedBaseLanguage) return true;
        return (BASE_LANGUAGE_CURRENCY_OPTIONS[requestedBaseLanguage] || []).includes(currency);
      })
      .map(([currency, details]) => [currency, { ...details }])
  );

  return {
    currencies_by_base_language: currenciesByBaseLanguage,
    currency_details: currencyDetails,
    currency_options: currencyOptions,
    base_languages: requestedBaseLanguage
      ? baseLanguages.filter((item) => item.base_language === requestedBaseLanguage)
      : baseLanguages
  };
}
