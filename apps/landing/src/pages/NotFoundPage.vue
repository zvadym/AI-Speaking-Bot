<template>
  <section class="page">
    <div class="container card">
      <h1 class="h2">Page not found</h1>
      <p class="muted">Try the home page.</p>
      <RouterLink class="btn" to="/">Home</RouterLink>
    </div>
  </section>
</template>

<script setup>
import { RouterLink } from 'vue-router';
</script>

<style scoped>
.page {
  padding: 56px 0;
}
</style>

