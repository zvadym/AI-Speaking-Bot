export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'pt', 'uk', 'it', 'tr'];

export const LANGUAGE_SLUG_TOKENS = {
  en: {
    en: 'english',
    de: 'german',
    it: 'italian',
    uk: 'ukrainian',
    ru: 'russian',
    pl: 'polish',
    es: 'spanish',
    fr: 'french'
  },
  de: {
    en: 'englisch',
    de: 'deutsch',
    it: 'italienisch',
    uk: 'ukrainisch',
    ru: 'russisch',
    pl: 'polnisch',
    es: 'spanisch',
    fr: 'franzoesisch'
  },
  es: {
    en: 'ingles',
    de: 'aleman',
    it: 'italiano',
    uk: 'ucraniano',
    ru: 'ruso',
    pl: 'polaco',
    es: 'espanol',
    fr: 'frances'
  },
  pt: {
    en: 'ingles',
    de: 'alemao',
    it: 'italiano',
    uk: 'ucraniano',
    ru: 'russo',
    pl: 'polones',
    es: 'espanhol',
    fr: 'frances'
  },
  uk: {
    en: 'anhliyska',
    de: 'nimetska',
    it: 'italiyska',
    uk: 'ukrayinska',
    ru: 'rosiyska',
    pl: 'polska',
    es: 'ispanska',
    fr: 'frantsuzka'
  },
  it: {
    en: 'inglese',
    de: 'tedesco',
    it: 'italiano',
    uk: 'ucraino',
    ru: 'russo',
    pl: 'polacco',
    es: 'spagnolo',
    fr: 'francese'
  },
  tr: {
    en: 'ingilizce',
    de: 'almanca',
    it: 'italyanca',
    uk: 'ukraynaca',
    ru: 'rusca',
    pl: 'lehce',
    es: 'ispanyolca',
    fr: 'fransizca'
  }
};

export const HUB_TOPIC_SLUG_TOKENS = {
  en: {
    speaking: 'speaking-practice',
    interview: 'interview-prep'
  },
  de: {
    speaking: 'sprechpraxis',
    interview: 'vorstellungsgespraech'
  },
  es: {
    speaking: 'practica-conversacion',
    interview: 'entrevista'
  },
  pt: {
    speaking: 'pratica-conversacao',
    interview: 'entrevista'
  },
  uk: {
    speaking: 'rozmovna-praktyka',
    interview: 'spivbesida'
  },
  it: {
    speaking: 'pratica-conversazione',
    interview: 'colloquio'
  },
  tr: {
    speaking: 'konusma-pratigi',
    interview: 'is-gorusmesi'
  }
};

export const HUB_TOPIC_KEYS = ['speaking', 'interview'];

export function normalizeLanguageCodeForSlugs(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'uk' || raw === 'uk-ua' || raw === 'ua' || raw === 'ua-ua') return 'uk';
  if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(raw)) return raw.slice(0, 2);
  return '';
}

function normalizeLocaleForSlugs(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (SUPPORTED_LOCALES.includes(raw)) return raw;
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('de')) return 'de';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('uk') || raw.startsWith('ua')) return 'uk';
  if (raw.startsWith('it')) return 'it';
  if (raw.startsWith('tr')) return 'tr';
  return 'en';
}

export function getLanguageSlugToken(locale, languageCode) {
  const loc = normalizeLocaleForSlugs(locale);
  const code = normalizeLanguageCodeForSlugs(languageCode);
  if (!code) return '';
  const token = LANGUAGE_SLUG_TOKENS[loc]?.[code];
  if (token) return token;
  return code;
}

export function getLanguageCodeBySlugToken(locale, slugToken) {
  const loc = normalizeLocaleForSlugs(locale);
  const normalized = (slugToken || '').toString().trim().toLowerCase();
  const entries = Object.entries(LANGUAGE_SLUG_TOKENS[loc] || {});
  const found = entries.find(([, token]) => token === normalized);
  if (found) return found[0];
  return '';
}

export function getTopicSlugToken(locale, topicKey) {
  const loc = normalizeLocaleForSlugs(locale);
  const key = (topicKey || '').toString().trim().toLowerCase();
  return HUB_TOPIC_SLUG_TOKENS[loc]?.[key] || '';
}

export function getTopicKeyBySlugToken(locale, topicSlug) {
  const loc = normalizeLocaleForSlugs(locale);
  const normalized = (topicSlug || '').toString().trim().toLowerCase();
  const entries = Object.entries(HUB_TOPIC_SLUG_TOKENS[loc] || {});
  const found = entries.find(([, token]) => token === normalized);
  if (found) return found[0];
  return '';
}
