import { watch, ref, inject } from 'vue';
import en from './locales/en.json';
import uk from './locales/uk.json';
import it from './locales/it.json';
import { getTeacherBySlug } from './data/teachers.js';

const STORAGE_KEY = 'landing_ui_locale';
const I18N_SYMBOL = Symbol('landing_i18n');

const messages = { en, uk, it };
export const supportedLocales = ['en', 'uk', 'it'];

export function normalizeLocale(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'uk' || raw === 'uk-ua' || raw === 'ua' || raw === 'ua-ua') return 'uk';
  if (raw === 'it' || raw.startsWith('it-')) return 'it';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return '';
}

export function getLocaleFromPathname(pathname = '') {
  const rawPath = (pathname || '').toString().trim();
  const segment = rawPath.split('/').filter(Boolean)[0] || '';
  return normalizeLocale(segment);
}

function stripLocalePrefix(pathname = '') {
  const rawPath = (pathname || '').toString().trim();
  const match = rawPath.match(/^\/([a-zA-Z-]+)(?=\/|$)/);
  if (!match) return rawPath || '/';
  const localeMatch = normalizeLocale(match[1]);
  if (!localeMatch) return rawPath || '/';
  const trimmed = rawPath.slice(match[0].length);
  return trimmed || '/';
}

function loadSavedLocale() {
  try {
    return normalizeLocale(window.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

function saveLocale(value) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

function getTeacherLocaleHintFromPathname() {
  try {
    const pathname = stripLocalePrefix(window.location?.pathname || '');
    const match = pathname.match(/^\/teachers\/([^/]+)$/);
    if (!match) return '';
    const teacher = getTeacherBySlug(match[1]);
    return normalizeLocale(teacher?.baseLanguage) || '';
  } catch {
    return '';
  }
}

export function getInitialLocale() {
  const routeLocale = getLocaleFromPathname(window.location?.pathname || '');
  if (routeLocale) return routeLocale;

  const saved = loadSavedLocale();
  if (saved) return saved;

  const teacherHint = getTeacherLocaleHintFromPathname();
  if (teacherHint) return teacherHint;

  const browserHint = normalizeLocale(navigator?.language);
  if (browserHint) return browserHint;

  return 'en';
}

export const locale = ref(getInitialLocale());

function getByPath(value, path) {
  if (!value) return null;
  const keys = (path || '').split('.').filter(Boolean);
  let current = value;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) current = current[key];
    else return null;
  }
  return current;
}

function format(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function t(key, params) {
  const primary = getByPath(messages[locale.value], key);
  if (typeof primary === 'string') return format(primary, params);
  const fallback = getByPath(messages.en, key);
  if (typeof fallback === 'string') return format(fallback, params);
  return key;
}

export function setAppLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale);
  if (!normalized) return;
  locale.value = normalized;
  saveLocale(normalized);
}

export function routeWithLocale(name, params = {}, options = {}) {
  const targetLocale =
    normalizeLocale(options.locale) || normalizeLocale(params.locale) || normalizeLocale(locale.value) || 'en';
  const nextParams = { ...params, locale: targetLocale };
  const location = { name, params: nextParams };
  if (options.hash) location.hash = options.hash;
  if (options.query) location.query = options.query;
  return location;
}

export const i18n = {
  install(app) {
    app.config.globalProperties.$t = t;
    app.provide(I18N_SYMBOL, { t, locale, setAppLocale });
  }
};

function syncHtmlLang(value) {
  try {
    document?.documentElement?.setAttribute('lang', value);
  } catch {
    // ignore
  }
}

syncHtmlLang(locale.value);
watch(locale, (value) => syncHtmlLang(value));

export function useI18n() {
  return inject(I18N_SYMBOL, { t, locale, setAppLocale });
}
