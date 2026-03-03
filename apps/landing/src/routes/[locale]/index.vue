<template>
  <HomePage />
</template>

<script setup>
import { computed } from 'vue';
import HomePage from '~/pages/HomePage.vue';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  layout: 'default',
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const { t, tm } = useI18n();

const siteUrl = computed(() => {
  const raw = (runtimeConfig.public.siteUrl || 'https://ai-language-school.online').toString().trim();
  return (raw || 'https://ai-language-school.online').replace(/\/+$/, '');
});

const faqItems = computed(() => {
  const raw = tm('faq.items');
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      question: (item?.q || '').toString().trim(),
      answer: (item?.a || '').toString().trim()
    }))
    .filter((item) => item.question && item.answer);
});

const structuredData = computed(() => ([
  {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': `${siteUrl.value}/#organization`,
    name: 'AI Language School',
    url: siteUrl.value,
    description: (t('home.seoDescription') || t('home.subhead') || '').toString()
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl.value}/#website`,
    name: 'AI Language School',
    url: siteUrl.value,
    inLanguage: localeCode.value,
    publisher: {
      '@id': `${siteUrl.value}/#organization`
    }
  }
]));

useLocalizedSeo({
  locale: localeCode,
  title: () => t('home.seoTitle') || 'AI Language School',
  description: () => t('home.seoDescription') || t('home.subhead'),
  faqItems,
  structuredData
});
</script>
