<script setup>
import { resolvePracticePathRouteBySlug } from '~/data/practicePathSlugs.js';

const route = useRoute();
const rawSlug = route.params?.slug;
const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
const encodedSlug = encodeURIComponent((slug || '').toString());
const resolution = resolvePracticePathRouteBySlug('', slug);
const targetPath = resolution?.canonicalPath || `/en/practice/${encodedSlug}`;
await navigateTo({ path: targetPath, query: route.query, hash: route.hash }, { redirectCode: 301 });
</script>

<template>
  <div />
</template>
