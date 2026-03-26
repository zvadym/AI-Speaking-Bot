<script setup>
const route = useRoute();
const locale = Array.isArray(route.params?.locale) ? route.params.locale[0] : route.params?.locale;
await navigateTo({ path: `/${locale || 'en'}/practice`, query: route.query, hash: route.hash }, { redirectCode: 301 });
</script>

<template>
  <div />
</template>
