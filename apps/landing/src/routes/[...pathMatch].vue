<template>
  <NotFoundPage />
</template>

<script setup>
import { setResponseStatus } from 'h3';
import NotFoundPage from '~/pages/NotFoundPage.vue';
import { useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

const event = useRequestEvent();
if (event) setResponseStatus(event, 404);

const { t } = useI18n();

useLocalizedSeo({
  locale: 'en',
  pathSuffix: '/',
  title: () => `${t('notFound.title')} — AI Language School`,
  description: () => t('notFound.desc'),
  noindex: true
});
</script>
