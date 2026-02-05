import { watch } from 'vue';
import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import uk from './locales/uk.json';

const STORAGE_KEY = 'miniapp_ui_locale';

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

function saveLocale(locale) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export function getInitialLocale() {
  return loadSavedLocale() || 'uk';
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages: { en, uk }
});

function syncHtmlLang(value) {
  try {
    document?.documentElement?.setAttribute('lang', value);
  } catch {
    // ignore
  }
}

syncHtmlLang(i18n.global.locale.value);
watch(i18n.global.locale, (value) => syncHtmlLang(value));

export function setAppLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale);
  if (!normalized) return;
  i18n.global.locale.value = normalized;
  saveLocale(normalized);
}
