<template>
  <PracticePathsPage />
</template>

<script setup>
import { computed } from 'vue';
import PracticePathsPage from '~/pages/PracticePathsPage.vue';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  layout: 'default',
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const { t } = useI18n();

useLocalizedSeo({
  locale: localeCode,
  title: () => `${t('nav.practice')} — AI Language School`,
  description: () => t('practice.subhead')
});
</script>
