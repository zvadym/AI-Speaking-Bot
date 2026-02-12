<template>
  <footer class="home-footer">
    <div class="container footer-inner">
      <div class="brand">
        <div class="brand-name">AI Language School</div>
        <div class="muted brand-desc">Voice-first language practice in Telegram.</div>
      </div>

      <div class="links">
        <RouterLink :to="routeWithLocale('teachers')">{{ t('nav.teachers') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#pricing' })">{{ t('nav.pricing') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#blog' })">{{ t('nav.blog') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#about' })">{{ t('nav.about') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#contact' })">{{ t('nav.contact') }}</RouterLink>
      </div>
    </div>

    <div class="container bottom muted">
      © {{ year }} AI Language School
    </div>
  </footer>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { routeWithLocale, useI18n } from '../i18n.js';

const year = computed(() => new Date().getFullYear());
const { t } = useI18n();
</script>

<style scoped>
.home-footer {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 70%, var(--surface));
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.footer-inner {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  padding: 24px 0;
}

.brand-name {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.brand-desc {
  margin-top: 4px;
}

.links {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.bottom {
  padding-bottom: 20px;
}

@media (min-width: 860px) {
  .footer-inner {
    grid-template-columns: 1fr auto;
    align-items: start;
  }
}
</style>
