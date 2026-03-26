<script setup>
import { resolvePracticePathRouteBySlug } from '~/data/practicePathSlugs.js';

const route = useRoute();
const locale = Array.isArray(route.params?.locale) ? route.params.locale[0] : route.params?.locale;
const rawSlug = route.params?.slug;
const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
const encodedSlug = encodeURIComponent((slug || '').toString());
const resolution = resolvePracticePathRouteBySlug(locale, slug);
const targetPath = resolution?.canonicalPath || `/${locale || 'en'}/practice/${encodedSlug}`;
await navigateTo({ path: targetPath, query: route.query, hash: route.hash }, { redirectCode: 301 });
</script>

<template>
  <div />
</template>
