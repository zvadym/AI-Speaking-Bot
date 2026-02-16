<template>
  <TeacherProfilePage :teacher="teacher" />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import TeacherProfilePage from '~/pages/TeacherProfilePage.vue';
import { teachers, getTeacherName, getTeacherTagline } from '~/data/teachers.js';
import {
  findTeacherByPublicSlug,
  getAlternateTeacherPaths,
  getTeacherPathSuffix,
  isLegacyPairSlug
} from '~/data/teacherSlugs.js';
import { getTeacherTelegramUrl } from '~/lib/telegram.js';
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

const teacher = computed(() => findTeacherByPublicSlug(localeCode.value, slug.value));
const legacyPairSlug = computed(() => isLegacyPairSlug(slug.value));
const { t } = useI18n();

if (event && (!teacher.value || legacyPairSlug.value)) {
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
  return getTeacherSeoContent(teacher.value, localeCode.value);
});

const alternatePaths = computed(() => {
  if (!teacher.value) return {};
  return getAlternateTeacherPaths(teacher.value);
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

  const locale = localeCode.value;
  const languageLabel = t(`languageName.${teacher.value.learningLanguage}`);
  const teacherPathSuffix = getTeacherPathSuffix(teacher.value, locale) || '/teachers';

  const personSchemas = teachers.map((row) => {
    const pathSuffix = getTeacherPathSuffix(row, locale) || '/teachers';
    const url = toAbsoluteUrl(`/${locale}${pathSuffix}`);
    const image = row.avatarImage ? toAbsoluteUrl(row.avatarImage) : '';
    const telegramUrl = getTeacherTelegramUrl(row);
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
          item: toAbsoluteUrl(`/${locale}${teacherPathSuffix}`)
        }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('nav.teachers'),
      itemListElement: teachers.map((row, idx) => {
        const rowPathSuffix = getTeacherPathSuffix(row, locale) || '/teachers';
        return {
          '@type': 'ListItem',
          position: idx + 1,
          url: toAbsoluteUrl(`/${locale}${rowPathSuffix}`),
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
      '@type': 'SoftwareApplication',
      name: `AI Language School ${languageLabel} Teacher`,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Telegram',
      inLanguage: locale,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EUR'
      },
      url: toAbsoluteUrl(`/${locale}${teacherPathSuffix}`)
    }
  ];
});

useLocalizedSeo({
  locale: localeCode,
  pathSuffix: () => {
    if (teacher.value) return getTeacherPathSuffix(teacher.value, localeCode.value) || '/teachers';
    return `/teachers/${encodeURIComponent(slug.value)}`;
  },
  alternatePathByLocale: () => alternatePaths.value,
  title: () => seoContent.value?.metaTitle || `${t('notFound.title')} — AI Language School`,
  description: () => seoContent.value?.metaDescription || t('notFound.desc'),
  noindex: () => !teacher.value || legacyPairSlug.value,
  structuredData
});
</script>
