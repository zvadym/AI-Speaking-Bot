import { supportedLocales } from './i18n.js';

const DEFAULT_SITE_URL = 'https://ai-language-school.online';
const SITE_URL = ((import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL).toString().trim() || DEFAULT_SITE_URL).replace(
  /\/+$/,
  ''
);

function normalizePath(pathname = '') {
  const raw = (pathname || '').toString().trim();
  if (!raw) return '/';
  if (raw === '/') return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function stripLocalePrefix(pathname = '') {
  const normalized = normalizePath(pathname);
  const pattern = new RegExp(`^\\/(${supportedLocales.join('|')})(?=\\/|$)`, 'i');
  const stripped = normalized.replace(pattern, '');
  return stripped || '/';
}

function localizedPath(pathname = '', locale = 'en') {
  const suffix = stripLocalePrefix(pathname);
  if (suffix === '/') return `/${locale}`;
  return `/${locale}${suffix}`;
}

function toAbsoluteUrl(pathname = '') {
  return `${SITE_URL}${normalizePath(pathname)}`;
}

function upsertLinkTag({ id, rel, href, hreflang }) {
  if (!id) return;
  let link = document.head.querySelector(`link[data-seo-id="${id}"]`);
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('data-seo-id', id);
    document.head.appendChild(link);
  }
  link.setAttribute('rel', rel);
  link.setAttribute('href', href);
  if (hreflang) link.setAttribute('hreflang', hreflang);
  else link.removeAttribute('hreflang');
}

function upsertMetaTag({ id, name, content }) {
  if (!id) return;
  let meta = document.head.querySelector(`meta[data-seo-id="${id}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('data-seo-id', id);
    document.head.appendChild(meta);
  }
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
}

export function syncSeoLinks(route, locale) {
  if (typeof document === 'undefined' || !route) return;

  const activeLocale = supportedLocales.includes(locale) ? locale : 'en';
  const currentPath = normalizePath(route.path || '/');
  const pathWithoutLocale = stripLocalePrefix(currentPath);

  upsertLinkTag({
    id: 'canonical',
    rel: 'canonical',
    href: toAbsoluteUrl(localizedPath(pathWithoutLocale, activeLocale))
  });

  for (const altLocale of supportedLocales) {
    upsertLinkTag({
      id: `alternate-${altLocale}`,
      rel: 'alternate',
      href: toAbsoluteUrl(localizedPath(pathWithoutLocale, altLocale)),
      hreflang: altLocale
    });
  }

  upsertLinkTag({
    id: 'alternate-x-default',
    rel: 'alternate',
    href: toAbsoluteUrl(localizedPath(pathWithoutLocale, 'en')),
    hreflang: 'x-default'
  });

  const isNotFound = route.name === 'not-found';
  upsertMetaTag({
    id: 'robots',
    name: 'robots',
    content: isNotFound ? 'noindex,follow' : 'index,follow'
  });
}
