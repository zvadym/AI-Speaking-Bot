<script setup>
const route = useRoute();
await navigateTo({ path: '/en', query: route.query, hash: route.hash }, { redirectCode: 301 });
</script>

<template>
  <div />
</template>
