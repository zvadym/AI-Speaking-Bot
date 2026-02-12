<template>
  <section class="page">
    <div class="container card">
      <h1 class="h2">{{ t('notFound.title') }}</h1>
      <p class="muted">{{ t('notFound.desc') }}</p>
      <RouterLink class="btn" :to="routeWithLocale('home')">{{ t('nav.home') }}</RouterLink>
    </div>
  </section>
</template>

<script setup>
import { RouterLink } from 'vue-router';
import { routeWithLocale, useI18n } from '../i18n.js';

const { t } = useI18n();
</script>

<style scoped>
.page {
  padding: 56px 0;
}
</style>
