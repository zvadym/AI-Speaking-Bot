import { watch, ref, inject } from 'vue';
import en from './locales/en.json';
import uk from './locales/uk.json';

const STORAGE_KEY = 'miniapp_ui_locale';
const I18N_SYMBOL = Symbol('miniapp_i18n');

function normalizeLocale(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'uk' || raw === 'uk-ua' || raw === 'ua' || raw === 'ua-ua') return 'uk';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return '';
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

export function getInitialLocale() {
  return loadSavedLocale() || 'uk';
}

const messages = { en, uk };
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

export const i18n = {
  install(app) {
    app.config.globalProperties.$t = t;
    app.provide(I18N_SYMBOL, { t, locale });
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

export function setAppLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale);
  if (!normalized) return;
  locale.value = normalized;
  saveLocale(normalized);
}

export function useI18n() {
  return inject(I18N_SYMBOL, { t, locale });
}
