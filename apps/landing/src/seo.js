import { computed, unref } from 'vue';
import { useHead, useRuntimeConfig, useRoute } from '#imports';
import { localizedPath, normalizeLocale, stripLocalePrefix, supportedLocales } from './i18n.js';

const DEFAULT_SITE_URL = 'https://ai-language-school.online';
const DEFAULT_DESCRIPTION = 'Voice-first language practice in Telegram.';
const DEFAULT_OG_IMAGE_PATH = '/og_tag_img.png';

function normalizePath(pathname = '') {
  const raw = (pathname || '').toString().trim();
  if (!raw || raw === '/') return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function toAbsoluteUrl(siteUrl, pathname = '') {
  return `${siteUrl}${normalizePath(pathname)}`;
}

function readValue(input) {
  if (typeof input === 'function') return input();
  return unref(input);
}

function getSiteUrl() {
  const config = useRuntimeConfig();
  const raw = (config.public.siteUrl || DEFAULT_SITE_URL).toString().trim();
  return (raw || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function getDefaultOgImagePath() {
  const config = useRuntimeConfig();
  const raw = (config.public.ogImage || DEFAULT_OG_IMAGE_PATH).toString().trim();
  return raw || DEFAULT_OG_IMAGE_PATH;
}

function normalizeFaqItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      question: (item?.question || item?.q || '').toString().trim(),
      answer: (item?.answer || item?.a || '').toString().trim()
    }))
    .filter((item) => item.question && item.answer);
}

function normalizePathSuffixForLocale(pathname = '', locale = 'en') {
  const normalized = normalizePath(pathname);
  const localePrefix = `/${locale}`;
  if (normalized === localePrefix) return '/';
  if (normalized.startsWith(`${localePrefix}/`)) return stripLocalePrefix(normalized);
  return normalized;
}

function normalizeStructuredData(items) {
  if (!items) return [];
  const rows = Array.isArray(items) ? items : [items];
  return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

export function useLocalizedSeo(options = {}) {
  const route = useRoute();
  const siteUrl = getSiteUrl();
  const defaultOgImagePath = getDefaultOgImagePath();

  const activeLocale = computed(() => normalizeLocale(readValue(options.locale)) || 'en');
  const pathSuffix = computed(() => {
    const explicit = readValue(options.pathSuffix);
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
      return normalizePath(explicit);
    }
    return stripLocalePrefix(route.path || '/');
  });

  const alternatePathByLocale = computed(() => {
    const raw = readValue(options.alternatePathByLocale);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const map = {};
    for (const locale of supportedLocales) {
      const value = raw[locale];
      if (value === undefined || value === null || String(value).trim() === '') continue;
      map[locale] = normalizePathSuffixForLocale(value, locale);
    }
    return map;
  });

  const alternateLocales = computed(() => {
    const raw = readValue(options.allowedAlternateLocales);
    if (!Array.isArray(raw) || raw.length === 0) return supportedLocales;

    const normalized = Array.from(
      new Set(
        raw
          .map((value) => normalizeLocale(value))
          .filter(Boolean)
      )
    );
    return normalized.length ? normalized : supportedLocales;
  });

  const xDefaultLocale = computed(() => {
    const explicit = normalizeLocale(readValue(options.xDefaultLocale));
    if (explicit) return explicit;
    return alternateLocales.value[0] || 'en';
  });

  const canonicalPath = computed(() => {
    const override = alternatePathByLocale.value[activeLocale.value];
    const suffix = override || pathSuffix.value;
    return localizedPath(suffix, activeLocale.value);
  });

  useHead(() => {
    const title = (readValue(options.title) || 'AI Language School').toString();
    const description = (readValue(options.description) || '').toString().trim() || DEFAULT_DESCRIPTION;
    const robots = readValue(options.noindex) ? 'noindex,follow' : 'index,follow';
    const canonicalUrl = toAbsoluteUrl(siteUrl, canonicalPath.value);
    const imageAlt = (readValue(options.imageAlt) || title).toString().trim() || title;
    const imageInput = readValue(options.image);
    const imageValue = (imageInput === undefined || imageInput === null || String(imageInput).trim() === '')
      ? defaultOgImagePath
      : String(imageInput).trim();
    const imageUrl = imageValue.startsWith('http://') || imageValue.startsWith('https://')
      ? imageValue
      : toAbsoluteUrl(siteUrl, imageValue);
    const faqItems = normalizeFaqItems(readValue(options.faqItems));
    const structuredData = normalizeStructuredData(readValue(options.structuredData));
    const scripts = [];

    if (faqItems.length) {
      scripts.push({
        key: 'faq-jsonld',
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqItems.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer
            }
          }))
        })
      });
    }

    for (const [index, schemaObj] of structuredData.entries()) {
      scripts.push({
        key: `jsonld-${index}`,
        type: 'application/ld+json',
        children: JSON.stringify(schemaObj)
      });
    }

    return {
      title,
      meta: [
        { key: 'description', name: 'description', content: description },
        { key: 'robots', name: 'robots', content: robots },
        { key: 'og:type', property: 'og:type', content: 'website' },
        { key: 'og:site_name', property: 'og:site_name', content: 'AI Language School' },
        { key: 'og:title', property: 'og:title', content: title },
        { key: 'og:description', property: 'og:description', content: description },
        { key: 'og:url', property: 'og:url', content: canonicalUrl },
        { key: 'og:image', property: 'og:image', content: imageUrl },
        { key: 'og:image:secure_url', property: 'og:image:secure_url', content: imageUrl },
        { key: 'og:image:alt', property: 'og:image:alt', content: imageAlt },
        { key: 'twitter:card', name: 'twitter:card', content: 'summary_large_image' },
        { key: 'twitter:title', name: 'twitter:title', content: title },
        { key: 'twitter:description', name: 'twitter:description', content: description },
        { key: 'twitter:image', name: 'twitter:image', content: imageUrl },
        { key: 'twitter:image:alt', name: 'twitter:image:alt', content: imageAlt }
      ],
      link: [
        {
          key: 'canonical',
          rel: 'canonical',
          href: canonicalUrl
        },
        ...alternateLocales.value.map((altLocale) => ({
          key: `alternate-${altLocale}`,
          rel: 'alternate',
          hreflang: altLocale,
          href: toAbsoluteUrl(
            siteUrl,
            localizedPath(alternatePathByLocale.value[altLocale] || pathSuffix.value, altLocale)
          )
        })),
        {
          key: 'alternate-x-default',
          rel: 'alternate',
          hreflang: 'x-default',
          href: toAbsoluteUrl(
            siteUrl,
            localizedPath(
              alternatePathByLocale.value[xDefaultLocale.value] || pathSuffix.value,
              xDefaultLocale.value
            )
          )
        }
      ],
      script: scripts
    };
  });
}
