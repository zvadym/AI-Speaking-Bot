<template>
  <footer class="home-footer" aria-label="Footer">
    <div class="footer-top">
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

    <div class="footer-bottom muted">© {{ year }} AI Language School</div>
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
  border: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
  background:
    radial-gradient(120% 140% at 8% 0%, rgba(34, 158, 217, 0.12), transparent 44%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 82%, #60a5fa 18%) 0%,
      var(--surface) 55%,
      color-mix(in srgb, var(--surface) 86%, #34d399 14%) 100%
    );
  border-radius: var(--radius-xxl);
  box-shadow:
    var(--shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  overflow: hidden;
  padding: 20px;
  text-align: center;
}

.footer-top {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
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

.footer-bottom {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  font-size: 13px;
}

@media (min-width: 860px) {
  .home-footer {
    padding: 22px 24px;
    text-align: left;
  }

  .footer-top {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .links {
    justify-content: flex-end;
  }

  .footer-bottom {
    text-align: left;
  }
}
</style>
