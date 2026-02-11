<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" to="/">AI Language School</RouterLink>

      <nav class="nav">
        <RouterLink class="nav-link" to="/teachers">{{ t('nav.teachers') }}</RouterLink>

        <div class="locale" :aria-label="t('language.label')">
          <button
            v-for="opt in localeOptions"
            :key="opt.value"
            class="locale-btn"
            type="button"
            :aria-pressed="locale.value === opt.value"
            @click="setAppLocale(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>

        <RouterLink class="btn primary" to="/teachers">{{ t('cta.start') }}</RouterLink>
      </nav>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n, supportedLocales } from '../i18n.js';

const { t, locale, setAppLocale } = useI18n();

const localeOptions = computed(() => {
  return supportedLocales.map((value) => ({
    value,
    label: value.toUpperCase()
  }));
});
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

.locale {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px;
  background: var(--bg);
}

.locale-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 999px;
  cursor: pointer;
}

.locale-btn[aria-pressed='true'] {
  background: var(--fg);
  color: var(--bg);
}
</style>
