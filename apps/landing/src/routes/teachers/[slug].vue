<script setup>
const route = useRoute();
const rawSlug = route.params?.slug;
const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
const encodedSlug = encodeURIComponent((slug || '').toString());
await navigateTo(
  { path: `/en/teachers/${encodedSlug}`, query: route.query, hash: route.hash },
  { redirectCode: 301 }
);
</script>

<template>
  <div />
</template>
