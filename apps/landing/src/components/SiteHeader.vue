<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" to="/">AI Language School</RouterLink>

      <nav class="nav">
        <RouterLink
          class="nav-link"
          to="/teachers"
          :class="{ active: isTeachersActive }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.teachers') }}
        </RouterLink>

        <RouterLink
          class="nav-link"
          to="/#pricing"
          :class="{ active: activeSection === 'pricing' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.pricing') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          to="/#blog"
          :class="{ active: activeSection === 'blog' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.blog') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          to="/#about"
          :class="{ active: activeSection === 'about' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.about') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          to="/#contact"
          :class="{ active: activeSection === 'contact' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.contact') }}
        </RouterLink>

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
      </nav>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useRoute } from 'vue-router';
import { useI18n, supportedLocales } from '../i18n.js';

const { t, locale, setAppLocale } = useI18n();
const route = useRoute();

const SECTION_IDS = ['pricing', 'blog', 'about', 'contact'];
const activeSection = ref('');
let observer = null;

const isTeachersActive = computed(() => route.name === 'teachers' || route.name === 'teacher');

function normalizeHash(hash) {
  const raw = (hash || '').toString().trim();
  if (!raw.startsWith('#')) return '';
  const id = raw.slice(1);
  return SECTION_IDS.includes(id) ? id : '';
}

function setActiveFromRouteHash() {
  if (route.name !== 'home') {
    activeSection.value = '';
    return;
  }
  const id = normalizeHash(route.hash);
  if (id) activeSection.value = id;
}

function teardownObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function setupObserver() {
  teardownObserver();
  if (route.name !== 'home') return;
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

  const targets = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean);
  if (!targets.length) return;

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - 120) - Math.abs(b.boundingClientRect.top - 120));
      if (!visible.length) return;
      const id = visible[0]?.target?.id || '';
      if (SECTION_IDS.includes(id)) activeSection.value = id;
    },
    {
      root: null,
      threshold: [0.15, 0.25, 0.5],
      rootMargin: '-20% 0px -65% 0px'
    }
  );

  for (const el of targets) observer.observe(el);
}

const localeOptions = computed(() => {
  return supportedLocales.map((value) => ({
    value,
    label: value.toUpperCase()
  }));
});

onMounted(() => {
  setActiveFromRouteHash();
  setupObserver();
});

watch(
  () => route.name,
  () => {
    setActiveFromRouteHash();
    setupObserver();
  }
);

watch(
  () => route.hash,
  () => setActiveFromRouteHash()
);

onBeforeUnmount(() => teardownObserver());
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
  flex-wrap: wrap;
  justify-content: flex-end;
}

.nav-link {
  font-weight: 600;
  text-decoration: none;
}

.nav-link.active {
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
  box-shadow: var(--shadow);
}
</style>
