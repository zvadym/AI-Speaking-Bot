<template>
  <BlogPostPage :slug="slug" />
</template>

<script setup>
import { computed } from 'vue';
import { setResponseStatus } from 'h3';
import BlogPostPage from '~/pages/BlogPostPage.vue';
import { getBlogPostBySlug } from '~/data/blogPosts.js';
import { isSupportedLocale, normalizeLocale, useI18n } from '~/i18n.js';
import { useLocalizedSeo } from '~/seo.js';

definePageMeta({
  validate: (route) => isSupportedLocale(route.params?.locale)
});

const route = useRoute();
const event = useRequestEvent();
const localeCode = computed(() => normalizeLocale(route.params?.locale) || 'en');
const slug = computed(() => {
  const raw = route.params?.slug;
  if (Array.isArray(raw)) return (raw[0] || '').toString();
  return (raw || '').toString();
});
const post = computed(() => getBlogPostBySlug(slug.value));
const { t } = useI18n();

if (event && !post.value) {
  setResponseStatus(event, 404);
}

const postTitle = computed(() => {
  const map = post.value?.title || {};
  const text = map[localeCode.value] || map.en || map.uk || map.it || '';
  return (text || t('notFound.title')).toString();
});

const postDescription = computed(() => {
  const map = post.value?.excerpt || {};
  const text = map[localeCode.value] || map.en || map.uk || map.it || '';
  return (text || t('blog.subhead')).toString();
});

useLocalizedSeo({
  locale: localeCode,
  title: () => `${postTitle.value} — AI Language School`,
  description: () => postDescription.value,
  noindex: () => !post.value
});
</script>
