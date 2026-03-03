<template>
  <TeacherProfilePage :teacher="teacher" />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import TeacherProfilePage from '~/pages/TeacherProfilePage.vue';
import { teachers, getTeacherName, getTeacherTagline } from '~/data/teachers.js';
import {
  getTeacherCanonicalPath,
  getTeacherCanonicalPathSuffix,
  resolveTeacherRouteBySlug
} from '~/data/teacherSlugs.js';
import { getTeacherSeoContent } from '~/data/seoTeacherContent.js';
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

const resolution = computed(() => resolveTeacherRouteBySlug(localeCode.value, slug.value));
if (resolution.value?.canonicalPath && !resolution.value.isCanonicalRequest) {
  await navigateTo(
    {
      path: resolution.value.canonicalPath,
      query: route.query,
      hash: route.hash
    },
    { redirectCode: 301 }
  );
}

const teacher = computed(() => resolution.value?.teacher || null);
const pageLocale = computed(() => normalizeLocale(resolution.value?.canonicalLocale) || localeCode.value || 'en');
const { t } = useI18n();

if (event && !teacher.value) {
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
  if (!teacher.value) return null;
  return getTeacherSeoContent(teacher.value, pageLocale.value);
});

const canonicalPathSuffix = computed(() => {
  if (!teacher.value) return `/teachers/${encodeURIComponent(slug.value)}`;
  return getTeacherCanonicalPathSuffix(teacher.value) || '/teachers';
});

const alternatePaths = computed(() => {
  if (!teacher.value) return {};
  return {
    [pageLocale.value]: canonicalPathSuffix.value
  };
});

const faqItems = computed(() => {
  const rows = Array.isArray(seoContent.value?.faqItems) ? seoContent.value.faqItems : [];
  return rows
    .map((item) => ({
      question: (item?.question || '').toString().trim(),
      answer: (item?.answer || '').toString().trim()
    }))
    .filter((item) => item.question && item.answer);
});

const structuredData = computed(() => {
  if (!teacher.value || !seoContent.value) return [];

  const locale = pageLocale.value;
  const languageLabel = t(`languageName.${teacher.value.learningLanguage}`);

  const personSchemas = teachers.map((row) => {
    const url = toAbsoluteUrl(getTeacherCanonicalPath(row));
    const image = row.avatarImage ? toAbsoluteUrl(row.avatarImage) : '';
    const telegramUrl = (row.telegramUrl || '').toString().trim();
    return {
      '@context': 'https://schema.org',
      '@type': 'Person',
      '@id': `${url}#person`,
      name: getTeacherName(row, locale),
      description: getTeacherTagline(row, locale),
      image: image || undefined,
      url,
      sameAs: telegramUrl ? [telegramUrl] : undefined,
      knowsLanguage: [
        t(`languageName.${row.learningLanguage}`),
        t(`languageName.${row.baseLanguage}`)
      ].filter(Boolean)
    };
  });

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
      '@type': 'WebSite',
      '@id': `${siteUrl.value}/#website`,
      name: 'AI Language School',
      url: siteUrl.value,
      inLanguage: locale
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'AI Language School',
          item: toAbsoluteUrl(`/${locale}`)
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: t('nav.teachers'),
          item: toAbsoluteUrl(`/${locale}/teachers`)
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: getTeacherName(teacher.value, locale),
          item: toAbsoluteUrl(getTeacherCanonicalPath(teacher.value))
        }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('nav.teachers'),
      itemListElement: teachers.map((row, idx) => {
        return {
          '@type': 'ListItem',
          position: idx + 1,
          url: toAbsoluteUrl(getTeacherCanonicalPath(row)),
          name: getTeacherName(row, locale)
        };
      })
    },
    ...personSchemas,
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.value.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer
        }
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${toAbsoluteUrl(getTeacherCanonicalPath(teacher.value))}#service`,
      name: `AI Language School ${languageLabel} Teacher`,
      serviceType: 'AI language practice in Telegram',
      inLanguage: locale,
      provider: {
        '@id': `${siteUrl.value}/#organization`
      },
      availableChannel: teacher.value.telegramUrl
        ? {
            '@type': 'ServiceChannel',
            serviceUrl: teacher.value.telegramUrl
          }
        : undefined,
      url: toAbsoluteUrl(getTeacherCanonicalPath(teacher.value)),
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EUR'
      }
    }
  ];
});

useLocalizedSeo({
  locale: pageLocale,
  pathSuffix: () => canonicalPathSuffix.value,
  alternatePathByLocale: () => alternatePaths.value,
  allowedAlternateLocales: () => [pageLocale.value],
  xDefaultLocale: () => pageLocale.value,
  title: () => seoContent.value?.metaTitle || `${t('notFound.title')} — AI Language School`,
  description: () => seoContent.value?.metaDescription || t('notFound.desc'),
  image: () => teacher.value?.avatarImage,
  imageAlt: () => (teacher.value ? getTeacherName(teacher.value, pageLocale.value) : 'AI Language School'),
  noindex: () => !teacher.value,
  structuredData
});
</script>
