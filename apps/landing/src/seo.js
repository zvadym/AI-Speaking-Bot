import { computed, unref } from 'vue';
import { useHead, useRuntimeConfig, useSeoMeta, useRoute } from '#imports';
import { localizedPath, normalizeLocale, stripLocalePrefix, supportedLocales } from './i18n.js';

const DEFAULT_SITE_URL = 'https://ai-language-school.online';

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

function normalizeFaqItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      question: (item?.question || item?.q || '').toString().trim(),
      answer: (item?.answer || item?.a || '').toString().trim()
    }))
    .filter((item) => item.question && item.answer);
}

export function useLocalizedSeo(options = {}) {
  const route = useRoute();
  const siteUrl = getSiteUrl();

  const activeLocale = computed(() => normalizeLocale(readValue(options.locale)) || 'en');
  const pathSuffix = computed(() => {
    const explicit = readValue(options.pathSuffix);
    if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
      return normalizePath(explicit);
    }
    return stripLocalePrefix(route.path || '/');
  });

  const canonicalPath = computed(() => localizedPath(pathSuffix.value, activeLocale.value));

  useHead(() => {
    const faqItems = normalizeFaqItems(readValue(options.faqItems));
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

    return {
      title: (readValue(options.title) || 'AI Language School').toString(),
      link: [
        {
          key: 'canonical',
          rel: 'canonical',
          href: toAbsoluteUrl(siteUrl, canonicalPath.value)
        },
        ...supportedLocales.map((altLocale) => ({
          key: `alternate-${altLocale}`,
          rel: 'alternate',
          hreflang: altLocale,
          href: toAbsoluteUrl(siteUrl, localizedPath(pathSuffix.value, altLocale))
        })),
        {
          key: 'alternate-x-default',
          rel: 'alternate',
          hreflang: 'x-default',
          href: toAbsoluteUrl(siteUrl, localizedPath(pathSuffix.value, 'en'))
        }
      ],
      script: scripts
    };
  });

  useSeoMeta(() => ({
    description: (readValue(options.description) || '').toString(),
    robots: readValue(options.noindex) ? 'noindex,follow' : 'index,follow'
  }));
}
