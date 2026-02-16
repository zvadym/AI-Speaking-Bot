<template>
  <HomePage />
</template>

<script setup>
import { computed } from 'vue';
import HomePage from '~/pages/HomePage.vue';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const { t, tm } = useI18n();

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
    '@type': 'SoftwareApplication',
    name: 'AI Language School',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Telegram',
    inLanguage: localeCode.value,
    description: (t('home.seoDescription') || t('home.subhead') || '').toString()
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
