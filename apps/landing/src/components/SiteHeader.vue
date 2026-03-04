<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" :to="routeWithLocale('home')">AI Language School</RouterLink>

      <button
        class="menu-btn"
        type="button"
        :aria-label="t('nav.menu')"
        @click="openMobileMenu"
      >
        <span class="menu-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M4 6.5h16v2H4v-2Zm0 4.5h16v2H4v-2Zm0 4.5h16v2H4v-2Z" />
          </svg>
        </span>
      </button>

      <div
        ref="localePickerRef"
        class="locale-picker header-locale"
        :class="{ open: isLocaleMenuOpen }"
        :aria-label="t('language.label')"
      >
        <button
          class="locale-trigger"
          type="button"
          :aria-label="t('language.label')"
          aria-haspopup="true"
          :aria-expanded="isLocaleMenuOpen ? 'true' : 'false'"
          @click="toggleLocaleMenu"
        >
          <span class="locale-trigger-main">
            <span class="locale-trigger-flag" aria-hidden="true">{{ currentLocaleOption.flag }}</span>
            <span class="locale-trigger-code">{{ currentLocaleOption.label }}</span>
          </span>
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
            <span class="locale-item-flag" aria-hidden="true">{{ opt.flag }}</span>
            <span class="locale-item-meta">
              <span class="locale-item-name">{{ opt.name }}</span>
              <span class="locale-item-code">{{ opt.label }}</span>
            </span>
            <span class="locale-item-check" aria-hidden="true">{{ locale.value === opt.value ? '✓' : '' }}</span>
          </button>
        </div>
      </div>

      <nav class="nav" aria-label="Primary">
        <div class="nav-rail">
          <div class="nav-links">
            <RouterLink
              v-for="item in headerPrimaryItems"
              :key="item.key"
              class="nav-link"
              :to="item.to"
              :class="{ active: item.active }"
              active-class=""
              exact-active-class=""
              @click="closeLocaleMenu"
            >
              {{ item.label }}
            </RouterLink>
          </div>

          <div class="nav-divider" aria-hidden="true" />
        </div>

        <button type="button" class="try-now" :aria-label="t('cta.tryNow')" @click="openTryModal">
          <span class="telegram-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
              <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
            </svg>
          </span>
          <span class="try-now-text">{{ t('cta.tryNow') }}</span>
        </button>
      </nav>

      <button type="button" class="try-now try-now-mobile" :aria-label="t('cta.tryNow')" @click="openTryModal">
        <span class="telegram-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
            <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
          </svg>
        </span>
        <span class="try-now-text">{{ t('cta.tryNow') }}</span>
      </button>
    </div>

    <MobileMenuDrawer
      v-model:open="mobileMenuOpen"
      :title="t('nav.menu')"
      :primary-items="drawerPrimaryItems"
      :secondary-items="drawerSecondaryItems"
      @try="handleDrawerTry"
    />

    <TeacherTryModal v-model:open="tryTeacherModalOpen" />
  </header>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useRoute } from 'vue-router';
import MobileMenuDrawer from './MobileMenuDrawer.vue';
import TeacherTryModal from './TeacherTryModal.vue';
import { localizedPath, normalizeLocale, routeWithLocale, stripLocalePrefix, useI18n, supportedLocales } from '../i18n.js';

const { t, locale, setAppLocale } = useI18n();
const route = useRoute();

const NAV_ITEMS = [
  { key: 'teachers', type: 'route', labelKey: 'nav.teachers', routeName: 'teachers', primary: true },
  { key: 'features', type: 'section', labelKey: 'nav.features', sectionId: 'features', primary: true },
  { key: 'how', type: 'section', labelKey: 'nav.how', sectionId: 'how', primary: true },
  { key: 'pricing', type: 'section', labelKey: 'nav.pricing', sectionId: 'pricing', primary: true },
  { key: 'blog', type: 'section', labelKey: 'nav.blog', sectionId: 'blog', primary: true },
  { key: 'faq', type: 'section', labelKey: 'nav.faq', sectionId: 'faq', primary: true },
  { key: 'about', type: 'section', labelKey: 'nav.about', sectionId: 'about', primary: false },
  { key: 'contact', type: 'section', labelKey: 'nav.contact', sectionId: 'contact', primary: false }
];
const SECTION_IDS = NAV_ITEMS.filter((item) => item.type === 'section').map((item) => item.sectionId);
const activeSection = ref('');
let observer = null;
let rafId = 0;
let isScrollBound = false;
const isLocaleMenuOpen = ref(false);
const localePickerRef = ref(null);
const tryTeacherModalOpen = useState('tryTeacherModalOpen', () => false);
const mobileMenuOpen = useState('mobileMenuOpen', () => false);
const LOCALE_FLAGS = {
  en: '🇺🇸',
  de: '🇩🇪',
  es: '🇪🇸',
  pt: '🇵🇹',
  uk: '🇺🇦',
  it: '🇮🇹',
  tr: '🇹🇷',
  hi: '🇮🇳',
  ar: '🇸🇦',
  id: '🇮🇩'
};

const routeSuffix = computed(() => stripLocalePrefix(route.path || '/'));
const isHomeRoute = computed(() => routeSuffix.value === '/');
const isTeachersActive = computed(() => routeSuffix.value === '/teachers' || routeSuffix.value.startsWith('/teachers/'));
const isTeacherProfileRoute = computed(() => /^\/teachers\/[^/]+\/?$/u.test(routeSuffix.value));
const isBlogRoute = computed(() => routeSuffix.value === '/blog' || routeSuffix.value.startsWith('/blog/'));

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
  if (isScrollBound && import.meta.client) {
    window.removeEventListener('scroll', onScrollSpyTick);
    window.removeEventListener('resize', onScrollSpyTick);
    isScrollBound = false;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function getActiveSectionFromViewport() {
  if (typeof window === 'undefined') return '';
  const anchorY = 140;
  const sections = SECTION_IDS
    .map((id) => ({ id, el: document.getElementById(id) }))
    .filter((item) => item.el);

  if (!sections.length) return '';

  const inView = sections.find(({ el }) => {
    const rect = el.getBoundingClientRect();
    return rect.top <= anchorY && rect.bottom > anchorY;
  });
  if (inView) return inView.id;

  const nearest = sections.reduce(
    (best, current) => {
      const dist = Math.abs(current.el.getBoundingClientRect().top - anchorY);
      if (dist < best.distance) return { id: current.id, distance: dist };
      return best;
    },
    { id: '', distance: Number.POSITIVE_INFINITY }
  );

  return nearest.id;
}

function syncActiveSectionFromScroll() {
  if (!isHomeRoute.value) return;
  const next = getActiveSectionFromViewport();
  if (next) activeSection.value = next;
}

function onScrollSpyTick() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    syncActiveSectionFromScroll();
  });
}

function setupObserver() {
  teardownObserver();
  if (!isHomeRoute.value) return;
  if (typeof window === 'undefined') return;

  const targets = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean);
  if (targets.length && typeof IntersectionObserver !== 'undefined') {
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

  if (!isScrollBound) {
    window.addEventListener('scroll', onScrollSpyTick, { passive: true });
    window.addEventListener('resize', onScrollSpyTick);
    isScrollBound = true;
  }
  syncActiveSectionFromScroll();
}

function toNavPath(item) {
  if (!item) return routeWithLocale('home');
  if (item.type === 'route') return routeWithLocale(item.routeName || 'home');
  const hash = item.sectionId ? `#${item.sectionId}` : '';
  return routeWithLocale('home', {}, { hash });
}

function isItemActive(item) {
  if (!item) return false;
  if (item.key === 'teachers') return isTeachersActive.value;
  if (item.key === 'blog') return isBlogRoute.value || activeSection.value === 'blog';
  if (item.type === 'section') return activeSection.value === item.sectionId;
  return false;
}

const headerPrimaryItems = computed(() => {
  return NAV_ITEMS.filter((item) => item.primary).map((item) => ({
    key: item.key,
    label: t(item.labelKey),
    to: toNavPath(item),
    active: isItemActive(item)
  }));
});

const drawerPrimaryItems = computed(() => headerPrimaryItems.value);
const drawerSecondaryItems = computed(() => {
  return NAV_ITEMS.filter((item) => !item.primary).map((item) => ({
    key: item.key,
    label: t(item.labelKey),
    to: toNavPath(item),
    active: isItemActive(item)
  }));
});

async function switchLocale(nextLocale) {
  closeLocaleMenu();
  const normalized = normalizeLocale(nextLocale);
  if (!normalized || normalized === locale.value) return;
  setAppLocale(normalized);
  const targetPath = isTeacherProfileRoute.value
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

function openTryModal() {
  closeLocaleMenu();
  mobileMenuOpen.value = false;
  tryTeacherModalOpen.value = true;
}

function openMobileMenu() {
  closeLocaleMenu();
  mobileMenuOpen.value = true;
}

async function handleDrawerTry() {
  closeLocaleMenu();
  mobileMenuOpen.value = false;
  await nextTick();
  tryTeacherModalOpen.value = true;
}

function openLocaleMenu() {
  isLocaleMenuOpen.value = true;
}

function closeLocaleMenu() {
  isLocaleMenuOpen.value = false;
}

function toggleLocaleMenu() {
  if (isLocaleMenuOpen.value) {
    closeLocaleMenu();
    return;
  }
  openLocaleMenu();
}

function onGlobalPointerDown(event) {
  const picker = localePickerRef.value;
  const target = event?.target;
  if (!picker || !target || picker.contains(target)) return;
  closeLocaleMenu();
}

function onGlobalKeydown(event) {
  if (event?.key === 'Escape') closeLocaleMenu();
}

const localeOptions = computed(() => {
  return supportedLocales.map((value) => ({
    value,
    flag: LOCALE_FLAGS[value] || '🏳️',
    label: value.toUpperCase(),
    name: t(`language.${value}`)
  }));
});

const currentLocaleOption = computed(() => {
  return localeOptions.value.find((item) => item.value === locale.value) || localeOptions.value[0];
});

watch(
  mobileMenuOpen,
  (isOpen) => {
    if (isOpen) closeLocaleMenu();
  },
  { immediate: true }
);

onMounted(() => {
  if (import.meta.client) {
    document.addEventListener('pointerdown', onGlobalPointerDown);
    window.addEventListener('keydown', onGlobalKeydown);
  }
  setActiveFromRouteHash();
  setupObserver();
});

watch(
  () => route.path,
  () => {
    closeLocaleMenu();
    mobileMenuOpen.value = false;
    setActiveFromRouteHash();
    setupObserver();
  }
);

watch(
  () => route.hash,
  () => {
    closeLocaleMenu();
    setActiveFromRouteHash();
  }
);

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('pointerdown', onGlobalPointerDown);
    window.removeEventListener('keydown', onGlobalKeydown);
  }
  teardownObserver();
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: 'brand nav locale';
  align-items: center;
  gap: 14px;
  padding: 16px 0;
}

.brand {
  grid-area: brand;
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  letter-spacing: -0.02em;
  text-decoration: none;
  white-space: nowrap;
}

.header-locale {
  grid-area: locale;
  width: 132px;
}

.menu-btn {
  display: none;
  grid-area: menu;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 88%, var(--surface));
  color: var(--fg);
  cursor: pointer;
  box-shadow: var(--shadow);
}

.menu-icon {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
}

.menu-icon svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}

.nav {
  grid-area: nav;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}

.nav-rail {
  max-width: min(760px, 100%);
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--fg) 16%, var(--border));
  border-radius: 999px;
  padding: 6px;
  background: color-mix(in srgb, var(--bg) 84%, var(--surface));
  box-shadow: 0 10px 24px rgba(10, 14, 24, 0.08);
}

.nav-links {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav-links::-webkit-scrollbar {
  display: none;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 14px;
  line-height: 1;
  font-weight: 700;
  color: color-mix(in srgb, var(--fg) 86%, var(--muted));
  text-decoration: none;
  white-space: nowrap;
  transition: color 140ms ease, background-color 140ms ease, transform 140ms ease;
}

.nav-link:hover {
  text-decoration: none;
  color: var(--fg);
  background: color-mix(in srgb, var(--surface) 82%, var(--bg));
}

.nav-link.active {
  color: var(--bg);
  background: var(--fg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg) 34%, transparent);
}

.nav-divider {
  display: none;
  width: 1px;
  height: 24px;
  background: color-mix(in srgb, var(--fg) 18%, var(--border));
}

.try-now {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, #229ed9 24%, var(--border));
  background:
    radial-gradient(140% 140% at 10% 10%, color-mix(in srgb, #229ed9 18%, transparent), transparent 55%),
    radial-gradient(140% 140% at 90% 84%, color-mix(in srgb, #34d399 14%, transparent), transparent 58%),
    color-mix(in srgb, var(--bg) 90%, var(--surface));
  color: var(--fg);
  font-weight: 900;
  letter-spacing: 0.02em;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
  transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.try-now * {
  cursor: pointer;
}

.try-now:hover {
  border-color: color-mix(in srgb, #229ed9 42%, var(--border));
  transform: translateY(-1px);
}

.try-now:active {
  transform: translateY(0);
}

.telegram-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, #229ed9 78%, var(--fg));
}

.telegram-mark svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.try-now-text {
  white-space: nowrap;
}

.try-now-mobile {
  display: none;
  grid-area: try;
}

.locale-picker {
  position: relative;
  width: 100%;
}

.locale-trigger {
  width: 100%;
  min-width: 0;
  min-height: 44px;
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

.locale-trigger-main {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.locale-trigger-flag {
  font-size: 14px;
  line-height: 1;
  transform: translateY(-0.5px);
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
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  width: 224px;
  min-width: 100%;
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

.locale-picker.open .locale-menu,
.locale-picker:focus-within .locale-menu {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.locale-picker.open .locale-trigger,
.locale-picker:focus-within .locale-trigger {
  border-color: color-mix(in srgb, var(--fg) 30%, var(--border));
  background: color-mix(in srgb, var(--surface) 40%, var(--bg));
}

.locale-item {
  width: 100%;
  border: 0;
  border-radius: 10px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
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
  font-weight: 700;
  text-transform: uppercase;
  color: var(--muted);
  margin-left: auto;
}

.locale-item-name {
  font-size: 13px;
  font-weight: 650;
  line-height: 1;
}

.locale-item-flag {
  font-size: 16px;
  line-height: 1;
}

.locale-item-meta {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
}

.locale-item-meta .locale-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.locale-item-check {
  width: 14px;
  text-align: right;
  color: color-mix(in srgb, var(--fg) 82%, var(--muted));
  font-size: 12px;
}

@media (max-width: 1020px) {
  .site-header .container {
    padding-inline: clamp(22px, 3.4vw, 34px);
  }

  .nav-rail {
    max-width: min(760px, 100%);
  }
}

@media (max-width: 820px) {
  .site-header .container {
    padding-inline: 18px;
  }

  .nav-rail {
    border-radius: 18px;
  }

  .nav-divider {
    display: none;
  }

  .nav {
    gap: 10px;
  }

  .nav-link {
    padding: 8px 12px;
  }
}

@media (max-width: 640px) {
  .header-inner {
    padding: 12px 0;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'brand locale menu'
      'try try try';
    row-gap: 10px;
  }

  .header-locale {
    width: 110px;
  }

  .nav {
    display: none;
  }

  .menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .try-now-mobile {
    display: inline-flex;
    justify-content: center;
    padding: 12px 14px;
    font-size: 14px;
  }

  .telegram-mark {
    width: 18px;
    height: 18px;
  }
}

@media (max-width: 420px) {
  .brand {
    max-width: 70vw;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .try-now-text {
    white-space: normal;
  }

  .locale-trigger-code {
    display: none;
  }

  .locale-trigger {
    padding: 8px 10px;
  }
}
</style>
