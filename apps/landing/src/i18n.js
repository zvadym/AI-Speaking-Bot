import { computed } from 'vue';
import { useRoute } from '#imports';
import en from './locales/en.json';
import de from './locales/de.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import uk from './locales/uk.json';
import it from './locales/it.json';
import tr from './locales/tr.json';
import hi from './locales/hi.json';
import ar from './locales/ar.json';
import id from './locales/id.json';

const STORAGE_KEY = 'landing_ui_locale';

const messages = { en, de, es, pt, uk, it, tr, hi, ar, id };
export const supportedLocales = ['en', 'de', 'es', 'pt', 'uk', 'it', 'tr', 'hi', 'ar', 'id'];
export const rtlLocales = ['ar'];

export function normalizeLocale(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'uk' || raw === 'uk-ua' || raw === 'ua' || raw === 'ua-ua') return 'uk';
  if (raw === 'de' || raw.startsWith('de-')) return 'de';
  if (raw === 'es' || raw.startsWith('es-')) return 'es';
  if (raw === 'pt' || raw === 'pt-br' || raw === 'pt-pt' || raw.startsWith('pt-')) return 'pt';
  if (raw === 'it' || raw.startsWith('it-')) return 'it';
  if (raw === 'tr' || raw === 'tr-tr' || raw.startsWith('tr-')) return 'tr';
  if (raw === 'hi' || raw === 'hi-in' || raw.startsWith('hi-')) return 'hi';
  if (raw === 'ar' || raw === 'ar-ar' || raw.startsWith('ar-')) return 'ar';
  if (raw === 'id' || raw === 'id-id' || raw.startsWith('id-')) return 'id';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return '';
}

export function isSupportedLocale(input) {
  return supportedLocales.includes(normalizeLocale(input));
}

export function getLocaleDirection(input) {
  const locale = normalizeLocale(input) || 'en';
  return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
}

export function getLocaleFromPathname(pathname = '') {
  const rawPath = (pathname || '').toString().trim();
  const segment = rawPath.split('/').filter(Boolean)[0] || '';
  return normalizeLocale(segment);
}

function normalizePath(pathname = '') {
  const raw = (pathname || '').toString().trim();
  if (!raw || raw === '/') return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function stripLocalePrefix(pathname = '') {
  const normalized = normalizePath(pathname);
  const pattern = new RegExp(`^\\/(${supportedLocales.join('|')})(?=\\/|$)`, 'i');
  const stripped = normalized.replace(pattern, '');
  return stripped || '/';
}

export function localizedPath(pathname = '', locale = 'en') {
  const activeLocale = normalizeLocale(locale) || 'en';
  const suffix = stripLocalePrefix(pathname);
  if (suffix === '/') return `/${activeLocale}`;
  return `/${activeLocale}${suffix}`;
}

function saveLocale(value) {
  if (!import.meta.client) return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

export function getSavedLocale() {
  if (!import.meta.client) return '';
  try {
    return normalizeLocale(window.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

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
  if (!params || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function readMessage(key, localeCode) {
  const normalized = normalizeLocale(localeCode) || 'en';
  const primary = getByPath(messages[normalized], key);
  if (primary !== null && primary !== undefined) return primary;
  return getByPath(messages.en, key);
}

function toQueryString(query) {
  if (!query || typeof query !== 'object') return '';
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (value === undefined || value === null) continue;
        params.append(key, String(value));
      }
      continue;
    }
    params.set(key, String(rawValue));
  }
  return params.toString();
}

function appendQueryAndHash(path, options = {}) {
  let result = normalizePath(path);
  const qs = toQueryString(options.query);
  if (qs) result += `?${qs}`;

  const hashRaw = (options.hash || '').toString().trim();
  if (hashRaw) {
    result += hashRaw.startsWith('#') ? hashRaw : `#${hashRaw}`;
  }

  return result;
}

function buildPathByName(name, params = {}) {
  if (typeof name !== 'string') return '/';
  if (name.startsWith('/')) return normalizePath(name);

  if (name === 'home') return '/';
  if (name === 'practice') return '/practice';

  if (name === 'practice-detail') {
    const slug = (params.slug || '').toString().trim();
    return slug ? `/practice/${encodeURIComponent(slug)}` : '/practice';
  }

  if (name === 'blog-post') {
    const slug = (params.slug || '').toString().trim();
    return slug ? `/blog/${encodeURIComponent(slug)}` : '/';
  }

  if (name === 'not-found') {
    const pathMatch = params.pathMatch;
    if (Array.isArray(pathMatch)) {
      return `/${pathMatch.map((part) => encodeURIComponent(String(part))).join('/')}`;
    }
    return normalizePath(pathMatch || '/');
  }

  return '/';
}

export function setAppLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale);
  if (!normalized) return;
  saveLocale(normalized);
}

export function routeWithLocale(name, params = {}, options = {}) {
  const route = useRoute();
  const fromRoute = normalizeLocale(route.params?.locale);
  const targetLocale = normalizeLocale(options.locale) || normalizeLocale(params.locale) || fromRoute || 'en';
  const basePath = buildPathByName(name, params);
  return appendQueryAndHash(localizedPath(basePath, targetLocale), options);
}

export function useI18n() {
  const route = useRoute();
  const locale = computed(() => normalizeLocale(route.params?.locale) || 'en');

  function t(key, params) {
    const value = readMessage(key, locale.value);
    if (typeof value === 'string') return format(value, params);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return key;
  }

  function tm(key, explicitLocale) {
    const localeCode = normalizeLocale(explicitLocale) || locale.value;
    return readMessage(key, localeCode);
  }

  return {
    t,
    tm,
    locale,
    setAppLocale
  };
}
