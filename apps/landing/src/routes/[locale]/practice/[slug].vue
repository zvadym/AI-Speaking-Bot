<template>
  <PracticePathPage :practice-path="practicePath" />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import PracticePathPage from '~/pages/PracticePathPage.vue';
import { practicePaths } from '~/data/practicePaths.js';
import { getPracticePathCanonicalPath, getPracticePathCanonicalPathSuffix, resolvePracticePathRouteBySlug } from '~/data/practicePathSlugs.js';
import { getPracticePathSeoContent } from '~/data/seoPracticePathContent.js';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  layout: 'default',
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const event = useRequestEvent();
const runtimeConfig = useRuntimeConfig();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const slug = computed(() => {
  const raw = route.params?.slug;
  if (Array.isArray(raw)) return (raw[0] || '').toString();
  return (raw || '').toString();
});

const resolution = computed(() => resolvePracticePathRouteBySlug(localeCode.value, slug.value));
if (resolution.value?.canonicalPath && !resolution.value.isCanonicalRequest) {
  await navigateTo({ path: resolution.value.canonicalPath, query: route.query, hash: route.hash }, { redirectCode: 301 });
}

const practicePath = computed(() => resolution.value?.practicePath || null);
const pageLocale = computed(() => normalizeLocale(resolution.value?.canonicalLocale) || localeCode.value || 'en');
const { t } = useI18n();

if (event && !practicePath.value) {
  setResponseStatus(event, 404);
}

const siteUrl = computed(() => {
  const raw = (runtimeConfig.public.siteUrl || 'https://ai-language-school.online').toString().trim();
  return (raw || 'https://ai-language-school.online').replace(/\/+$/, '');
});

function toAbsoluteUrl(pathname = '/') {
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${siteUrl.value}${cleanPath}`;
}

const seoContent = computed(() => {
  if (!practicePath.value) return null;
  return getPracticePathSeoContent(practicePath.value, pageLocale.value, t);
});

const canonicalPathSuffix = computed(() => {
  if (!practicePath.value) return `/practice/${encodeURIComponent(slug.value)}`;
  return getPracticePathCanonicalPathSuffix(practicePath.value) || '/practice';
});

const structuredData = computed(() => {
  if (!practicePath.value || !seoContent.value) return [];
  const locale = pageLocale.value;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      '@id': `${siteUrl.value}/#organization`,
      name: 'AI Language School',
      url: siteUrl.value,
      description: seoContent.value.heroLead
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'AI Language School', item: toAbsoluteUrl(`/${locale}`) },
        { '@type': 'ListItem', position: 2, name: t('nav.practice'), item: toAbsoluteUrl(`/${locale}/practice`) },
        { '@type': 'ListItem', position: 3, name: seoContent.value.title, item: toAbsoluteUrl(getPracticePathCanonicalPath(practicePath.value)) }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('nav.practice'),
      itemListElement: practicePaths.map((row, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        url: toAbsoluteUrl(getPracticePathCanonicalPath(row)),
        name: `${t(`languageName.${row.baseLanguage}`)} → ${t(`languageName.${row.targetLanguage}`)}`
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${toAbsoluteUrl(getPracticePathCanonicalPath(practicePath.value))}#service`,
      name: `${seoContent.value.title} with Romi`,
      serviceType: 'Language speaking practice in Telegram',
      inLanguage: locale,
      provider: { '@id': `${siteUrl.value}/#organization` },
      availableChannel: practicePath.value.telegramUrl ? { '@type': 'ServiceChannel', serviceUrl: practicePath.value.telegramUrl } : undefined,
      url: toAbsoluteUrl(getPracticePathCanonicalPath(practicePath.value)),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: seoContent.value.faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    }
  ];
});

useLocalizedSeo({
  locale: pageLocale,
  pathSuffix: () => canonicalPathSuffix.value,
  alternatePathByLocale: () => ({ [pageLocale.value]: canonicalPathSuffix.value }),
  allowedAlternateLocales: () => [pageLocale.value],
  xDefaultLocale: () => pageLocale.value,
  title: () => seoContent.value?.metaTitle || `${t('notFound.title')} — AI Language School`,
  description: () => seoContent.value?.metaDescription || t('notFound.desc'),
  image: () => practicePath.value?.avatarImage,
  imageAlt: () => (seoContent.value?.title ? `Romi for ${seoContent.value.title}` : 'AI Language School'),
  noindex: () => !practicePath.value,
  structuredData
});
</script>
