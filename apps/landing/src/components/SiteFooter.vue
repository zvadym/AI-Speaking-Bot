<template>
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="brand">
        <div class="brand-name">AI Language School</div>
        <div class="muted brand-desc">Voice-first language practice in Telegram.</div>
      </div>

      <div class="links">
        <RouterLink to="/teachers">{{ t('nav.teachers') }}</RouterLink>
        <a href="https://vercel.com" target="_blank" rel="noreferrer">Hosting</a>
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
import { useI18n } from '../i18n.js';

const year = computed(() => new Date().getFullYear());
const { t } = useI18n();
</script>

<style scoped>
.site-footer {
  margin-top: 72px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.footer-inner {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  padding: 28px 0;
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
  padding-bottom: 22px;
}

@media (min-width: 860px) {
  .footer-inner {
    grid-template-columns: 1fr auto;
    align-items: start;
  }
}
</style>
