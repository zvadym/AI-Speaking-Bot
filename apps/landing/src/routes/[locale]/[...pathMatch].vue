<template>
  <NotFoundPage />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import NotFoundPage from '~/pages/NotFoundPage.vue';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const event = useRequestEvent();
if (event) setResponseStatus(event, 404);

const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const { t } = useI18n();

useLocalizedSeo({
  locale: localeCode,
  title: () => `${t('notFound.title')} — AI Language School`,
  description: () => t('notFound.desc'),
  noindex: true
});
</script>
