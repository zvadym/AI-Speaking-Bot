<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" to="/">AI Language School</RouterLink>

      <nav class="nav">
        <RouterLink class="nav-link" to="/teachers">Teachers</RouterLink>

        <a v-if="telegramUrl" class="btn primary" :href="telegramUrl" target="_blank" rel="noreferrer">
          Start in Telegram
        </a>
        <RouterLink v-else class="btn primary" to="/teachers">Start</RouterLink>
      </nav>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { getDefaultTelegramBotUrl } from '../lib/telegram.js';

const telegramUrl = computed(() => getDefaultTelegramBotUrl());
</script>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  border-bottom: 1px solid var(--border);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
}

.brand {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.nav {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nav-link {
  font-weight: 600;
  text-decoration: none;
}

.nav-link.router-link-active {
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>

