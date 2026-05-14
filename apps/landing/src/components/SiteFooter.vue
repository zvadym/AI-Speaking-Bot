<template>
  <footer class="site-footer" aria-label="Footer">
    <div class="container footer-inner">
      <div class="brand">
        <div class="brand-name">AI Language School</div>
        <div class="muted brand-desc">Voice-first language practice in Telegram.</div>
      </div>

      <nav class="links" aria-label="Footer links">
        <RouterLink :to="routeWithLocale('practice')">{{ t('nav.practice') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#pricing' })">{{ t('nav.pricing') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#blog' })">{{ t('nav.blog') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#about' })">{{ t('nav.about') }}</RouterLink>
        <RouterLink :to="routeWithLocale('home', {}, { hash: '#contact' })">{{ t('nav.contact') }}</RouterLink>
      </nav>
    </div>

    <div class="container bottom muted">© {{ year }} AI Language School</div>
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
.site-footer {
  margin-top: 96px;
  border-top: 1px solid color-mix(in srgb, var(--fg) 9%, transparent);
  background:
    radial-gradient(120% 140% at 8% 0%, rgba(34, 158, 217, 0.12), transparent 44%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 82%, #60a5fa 18%) 0%,
      var(--surface) 55%,
      color-mix(in srgb, var(--surface) 86%, #34d399 14%) 100%
    );
}

.footer-inner {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  padding: 42px 0 22px;
  text-align: center;
  align-items: start;
}

.brand {
  min-width: 0;
}

.brand-name {
  font-family: var(--font-display);
  font-weight: 900;
  letter-spacing: 0;
  font-size: 18px;
  line-height: 1.1;
}

.brand-desc {
  margin-top: 4px;
  line-height: 1.55;
}

.links {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.bottom {
  padding: 18px 0 34px;
  text-align: center;
  font-size: 13px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

@media (min-width: 860px) {
  .footer-inner {
    grid-template-columns: 1fr auto;
    align-items: center;
    text-align: left;
  }

  .links {
    justify-content: flex-end;
  }

  .bottom {
    text-align: left;
  }
}

.links :deep(a) {
  display: inline-flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  transition:
    background 560ms var(--motion-spring),
    border-color 560ms var(--motion-spring),
    transform 560ms var(--motion-spring);
}

.links :deep(a:hover) {
  background: var(--bg);
  border-color: var(--border);
  transform: translateY(-1px);
  text-decoration: none;
}

.links :deep(a:focus-visible) {
  outline: 3px solid color-mix(in srgb, #60a5fa 45%, transparent);
  outline-offset: 2px;
}
</style>
