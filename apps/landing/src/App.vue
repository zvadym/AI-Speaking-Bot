<template>
  <div class="app">
    <SiteHeader />
    <main>
      <RouterView />
    </main>
    <SiteFooter />
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';
import { getTeacherBySlug, getTeacherName } from './data/teachers.js';
import { locale, syncLocaleForTeacherRoute, t } from './i18n.js';

const route = useRoute();

function syncDocumentTitle() {
  const base = 'AI Language School';
  if (route.name === 'home') {
    document.title = base;
    return;
  }

  if (route.name === 'teachers') {
    document.title = `${t('nav.teachers')} — ${base}`;
    return;
  }

  if (route.name === 'teacher') {
    const slug = (route.params?.slug || '').toString();
    const teacher = getTeacherBySlug(slug);
    const name = getTeacherName(teacher, locale.value) || t('nav.teachers');
    document.title = `${name} — ${base}`;
    return;
  }

  document.title = `${t('notFound.title')} — ${base}`;
}

function syncLocaleFromRoute() {
  if (route.name !== 'teacher') return;
  const slug = (route.params?.slug || '').toString();
  if (slug) syncLocaleForTeacherRoute(slug);
}

onMounted(() => {
  syncLocaleFromRoute();
  syncDocumentTitle();
});

watch(
  () => route.fullPath,
  () => {
    syncLocaleFromRoute();
    syncDocumentTitle();
  }
);

watch(locale, () => syncDocumentTitle());
</script>
