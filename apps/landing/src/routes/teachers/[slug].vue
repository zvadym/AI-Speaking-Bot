<script setup>
import { resolveTeacherRouteBySlug } from '~/data/teacherSlugs.js';

const route = useRoute();
const rawSlug = route.params?.slug;
const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
const encodedSlug = encodeURIComponent((slug || '').toString());
const resolution = resolveTeacherRouteBySlug('', slug);
const targetPath = resolution?.canonicalPath || `/en/teachers/${encodedSlug}`;
await navigateTo(
  { path: targetPath, query: route.query, hash: route.hash },
  { redirectCode: 301 }
);
</script>

<template>
  <div />
</template>
