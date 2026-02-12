<template>
  <div class="app">
    <SiteHeader />
    <main>
      <RouterView />
    </main>
    <SiteFooter v-if="!isHome" />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';
import { getTeacherBySlug, getTeacherName } from './data/teachers.js';
import { getBlogPostBySlug } from './data/blogPosts.js';
import { locale, normalizeLocale, setAppLocale, t } from './i18n.js';
import { syncSeoLinks } from './seo.js';

const route = useRoute();
const isHome = computed(() => route.name === 'home');

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

  if (route.name === 'blog-post') {
    const slug = (route.params?.slug || '').toString();
    const post = getBlogPostBySlug(slug);
    const map = post?.title || {};
    const title = (map[locale.value] || map.en || map.uk || map.it || post?.slug || t('nav.blog')).toString();
    document.title = `${title} — ${base}`;
    return;
  }

  document.title = `${t('notFound.title')} — ${base}`;
}

function syncLocaleFromRoute() {
  const routeLocale = normalizeLocale(route.params?.locale);
  if (!routeLocale || routeLocale === locale.value) return;
  setAppLocale(routeLocale);
}

function syncHomeSnapClass() {
  try {
    document?.documentElement?.classList?.toggle('snap-home', isHome.value);
  } catch {
    // ignore
  }
}

onMounted(() => {
  syncLocaleFromRoute();
  syncDocumentTitle();
  syncHomeSnapClass();
  syncSeoLinks(route, locale.value);
});

watch(
  () => route.fullPath,
  () => {
    syncLocaleFromRoute();
    syncDocumentTitle();
    syncHomeSnapClass();
    syncSeoLinks(route, locale.value);
  }
);

watch(locale, () => {
  syncDocumentTitle();
  syncSeoLinks(route, locale.value);
});
</script>
