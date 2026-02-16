<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" :to="routeWithLocale('home')">AI Language School</RouterLink>

      <nav class="nav">
        <RouterLink
          class="nav-link"
          :to="routeWithLocale('teachers')"
          :class="{ active: isTeachersActive }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.teachers') }}
        </RouterLink>

        <RouterLink
          class="nav-link"
          :to="routeWithLocale('home', {}, { hash: '#pricing' })"
          :class="{ active: activeSection === 'pricing' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.pricing') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          :to="routeWithLocale('home', {}, { hash: '#blog' })"
          :class="{ active: activeSection === 'blog' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.blog') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          :to="routeWithLocale('home', {}, { hash: '#about' })"
          :class="{ active: activeSection === 'about' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.about') }}
        </RouterLink>
        <RouterLink
          class="nav-link"
          :to="routeWithLocale('home', {}, { hash: '#contact' })"
          :class="{ active: activeSection === 'contact' }"
          active-class=""
          exact-active-class=""
        >
          {{ t('nav.contact') }}
        </RouterLink>

        <div class="locale-picker" :aria-label="t('language.label')">
          <button class="locale-trigger" type="button" :aria-label="t('language.label')" aria-haspopup="true">
            <span class="locale-trigger-code">{{ currentLocaleOption.label }}</span>
            <span class="locale-trigger-caret" aria-hidden="true">▾</span>
          </button>

          <div class="locale-menu">
            <button
              v-for="opt in localeOptions"
              :key="opt.value"
              class="locale-item"
              type="button"
              :aria-pressed="locale.value === opt.value"
              @click="switchLocale(opt.value)"
            >
              <span class="locale-item-code">{{ opt.label }}</span>
              <span class="locale-item-name">{{ opt.name }}</span>
              <span class="locale-item-check" aria-hidden="true">{{ locale.value === opt.value ? '✓' : '' }}</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useRoute } from 'vue-router';
import { localizedPath, normalizeLocale, routeWithLocale, stripLocalePrefix, useI18n, supportedLocales } from '../i18n.js';

const { t, locale, setAppLocale } = useI18n();
const route = useRoute();

const SECTION_IDS = ['pricing', 'blog', 'about', 'contact'];
const activeSection = ref('');
let observer = null;

const routeSuffix = computed(() => stripLocalePrefix(route.path || '/'));
const isHomeRoute = computed(() => routeSuffix.value === '/');
const isTeachersActive = computed(() => routeSuffix.value === '/teachers' || routeSuffix.value.startsWith('/teachers/'));

function normalizeHash(hash) {
  const raw = (hash || '').toString().trim();
  if (!raw.startsWith('#')) return '';
  const id = raw.slice(1);
  return SECTION_IDS.includes(id) ? id : '';
}

function setActiveFromRouteHash() {
  if (!isHomeRoute.value) {
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
  if (!isHomeRoute.value) return;
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

async function switchLocale(nextLocale) {
  const normalized = normalizeLocale(nextLocale);
  if (!normalized || normalized === locale.value) return;
  setAppLocale(normalized);
  const targetPath = routeSuffix.value.startsWith('/teachers/')
    ? localizedPath('/', normalized)
    : localizedPath(routeSuffix.value, normalized);
  await navigateTo(
    {
      path: targetPath,
      query: route.query,
      hash: route.hash
    },
    { replace: true }
  );
}

const localeOptions = computed(() => {
  return supportedLocales.map((value) => ({
    value,
    label: value.toUpperCase(),
    name: value === 'uk' ? 'Ukrainian' : value === 'it' ? 'Italian' : 'English'
  }));
});

const currentLocaleOption = computed(() => {
  return localeOptions.value.find((item) => item.value === locale.value) || localeOptions.value[0];
});

onMounted(() => {
  setActiveFromRouteHash();
  setupObserver();
});

watch(
  () => route.path,
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

.locale-picker {
  position: relative;
}

.locale-trigger {
  min-width: 78px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 88%, var(--surface));
  color: var(--fg);
  font-weight: 800;
  letter-spacing: 0.04em;
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
  transition: border-color 140ms ease, transform 140ms ease, background-color 140ms ease;
}

.locale-trigger-code {
  display: inline-block;
  min-width: 20px;
  text-align: left;
}

.locale-trigger-caret {
  color: var(--muted);
  font-size: 11px;
  transform: translateY(-1px);
}

.locale-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 210px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--fg) 18%, var(--border));
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg) 78%, var(--surface));
  box-shadow: 0 24px 56px rgba(8, 12, 22, 0.2);
  backdrop-filter: blur(16px);
  opacity: 0;
  transform: translateY(-7px) scale(0.98);
  transform-origin: top right;
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
}

.locale-picker:hover .locale-menu,
.locale-picker:focus-within .locale-menu {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.locale-picker:hover .locale-trigger,
.locale-picker:focus-within .locale-trigger {
  border-color: color-mix(in srgb, var(--fg) 30%, var(--border));
  background: color-mix(in srgb, var(--surface) 40%, var(--bg));
}

.locale-item {
  width: 100%;
  border: 0;
  border-radius: 10px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  background: transparent;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
}

.locale-item:hover,
.locale-item:focus-visible,
.locale-item[aria-pressed='true'] {
  background: color-mix(in srgb, var(--surface) 78%, var(--bg));
}

.locale-item-code {
  font-size: 11px;
  letter-spacing: 0.05em;
  font-weight: 800;
  color: var(--muted);
}

.locale-item-name {
  font-size: 13px;
  font-weight: 650;
}

.locale-item-check {
  width: 14px;
  text-align: right;
  color: color-mix(in srgb, var(--fg) 82%, var(--muted));
  font-size: 12px;
}
</style>
