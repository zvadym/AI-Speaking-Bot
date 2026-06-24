<template>
  <header class="site-header">
    <div class="container header-shell">
      <div class="header-topline">
        <RouterLink class="brand" :to="routeWithLocale('home')">
          <span class="brand-full">AI Language School</span>
          <span class="brand-short">AI Language</span>
        </RouterLink>

        <div class="header-actions">
          <button type="button" class="try-now" :aria-label="t('cta.tryNow')" @click="openTryModal">
            <span class="telegram-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
                <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
              </svg>
            </span>
            <span class="try-now-text">{{ t('cta.tryNow') }}</span>
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
        </div>
      </div>

      <nav class="nav-row" aria-label="Primary">
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
      </nav>
    </div>

    <MobileMenuDrawer
      v-model:open="mobileMenuOpen"
      :title="t('nav.menu')"
      :primary-items="drawerPrimaryItems"
      :secondary-items="drawerSecondaryItems"
      @try="handleDrawerTry"
    />

    <PracticePathTryModal v-model:open="tryPracticeModalOpen" />
  </header>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useRoute } from 'vue-router';
import MobileMenuDrawer from './MobileMenuDrawer.vue';
import PracticePathTryModal from './PracticePathTryModal.vue';
import { localizedPath, normalizeLocale, routeWithLocale, stripLocalePrefix, useI18n, supportedLocales } from '../i18n.js';

const { t, locale, setAppLocale } = useI18n();
const route = useRoute();

const NAV_ITEMS = [
  { key: 'features', type: 'section', labelKey: 'nav.features', sectionId: 'features', primary: true },
  { key: 'practice', type: 'route', labelKey: 'nav.practice', routeName: 'practice', primary: true },
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
const tryPracticeModalOpen = useState('tryPracticeModalOpen', () => false);
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
const isPracticeActive = computed(() => routeSuffix.value === '/practice' || routeSuffix.value.startsWith('/practice/'));
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
  if (item.key === 'practice') return isPracticeActive.value;
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
  const targetPath = localizedPath(routeSuffix.value, normalized);
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
  tryPracticeModalOpen.value = true;
}

function openMobileMenu() {
  closeLocaleMenu();
  mobileMenuOpen.value = true;
}

async function handleDrawerTry() {
  closeLocaleMenu();
  mobileMenuOpen.value = false;
  await nextTick();
  tryPracticeModalOpen.value = true;
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
  z-index: 20;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  border-bottom: 1.5px solid var(--fg);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.header-shell {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(0, 1.8fr) auto;
  grid-template-areas: 'brand nav actions';
  align-items: center;
  gap: 24px;
  min-height: 74px;
  padding: 0 20px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.header-topline {
  display: contents;
}

.header-actions {
  grid-area: actions;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.brand {
  grid-area: brand;
  font-family: var(--font-display);
  font-weight: 900;
  letter-spacing: 0;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 20px;
  line-height: 1;
}

.brand-short {
  display: none;
}

.header-locale {
  width: 118px;
}

.menu-btn {
  display: none;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--fg);
  background: var(--surface);
  color: var(--fg);
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--fg);
  transition:
    transform 220ms var(--motion-soft),
    box-shadow 220ms var(--motion-soft),
    background-color 220ms var(--motion-soft);
}

.menu-btn:hover {
  background: var(--accent);
  transform: translate(-1px, -1px);
  box-shadow: 5px 5px 0 var(--fg);
}

.menu-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 var(--fg);
}

.menu-btn:focus-visible,
.nav-link:focus-visible,
.try-now:focus-visible,
.locale-trigger:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
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

.nav-row {
  grid-area: nav;
  min-width: 0;
  display: block;
}

.nav-rail {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.nav-links {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav-links::-webkit-scrollbar {
  display: none;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  padding: 10px 4px;
  font-size: 13px;
  line-height: 1;
  font-weight: 850;
  color: color-mix(in srgb, var(--fg) 76%, var(--muted));
  text-decoration: none;
  white-space: nowrap;
  transition:
    color 180ms var(--motion-soft),
    background-color 180ms var(--motion-soft);
}

.nav-link:hover {
  text-decoration: none;
  color: var(--fg);
  background: transparent;
}

.nav-link::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 2px;
  height: 2px;
  background: transparent;
}

.nav-link.active {
  color: var(--fg);
}

.nav-link.active::after {
  background: var(--fg);
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
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--fg);
  background: var(--accent);
  color: var(--fg);
  font-weight: 900;
  letter-spacing: 0;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 4px 4px 0 var(--fg);
  transition:
    transform 220ms var(--motion-soft),
    box-shadow 220ms var(--motion-soft),
    background-color 220ms var(--motion-soft);
}

.try-now * {
  cursor: pointer;
}

.try-now:hover {
  background: var(--surface);
  transform: translate(-1px, -1px);
  box-shadow: 6px 6px 0 var(--fg);
}

.try-now:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0 var(--fg);
}

.telegram-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--fg);
}

.telegram-mark svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.try-now-text {
  white-space: nowrap;
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
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--fg);
  font-weight: 800;
  letter-spacing: 0.04em;
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
  transition:
    transform 220ms var(--motion-soft),
    background-color 220ms var(--motion-soft);
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
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: 6px 6px 0 var(--fg);
  backdrop-filter: blur(16px);
  opacity: 0;
  transform: translateY(-7px) scale(0.98);
  transform-origin: top right;
  pointer-events: none;
  transition:
    opacity 220ms var(--motion-soft),
    transform 220ms var(--motion-soft);
}

.locale-picker.open .locale-menu,
.locale-picker:focus-within .locale-menu {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.locale-picker.open .locale-trigger,
.locale-picker:focus-within .locale-trigger {
  background: var(--accent);
}

.locale-item {
  width: 100%;
  border: 0;
  border-radius: var(--radius-sm);
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
  background: color-mix(in srgb, var(--accent) 42%, var(--surface));
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
  .header-shell {
    grid-template-columns: minmax(150px, 0.6fr) minmax(0, 1.3fr) auto;
    gap: 16px;
  }

  .nav-link {
    font-size: 12px;
  }
}

@media (max-width: 820px) {
  .header-shell {
    gap: 12px;
    padding-inline: 18px;
  }

  .nav-divider {
    display: none;
  }

  .nav-link {
    padding: 8px 12px;
  }
}

@media (max-width: 640px) {
  .header-shell {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'brand actions';
    min-height: 66px;
    gap: 12px;
    padding-inline: 16px;
  }

  .nav-row {
    display: none;
  }

  .header-actions .try-now {
    width: 44px;
    padding: 0;
  }

  .header-locale {
    width: 92px;
  }

  .menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .telegram-mark {
    width: 18px;
    height: 18px;
  }
}

@media (max-width: 420px) {
  .brand {
    font-size: 18px;
  }

  .brand-full {
    display: none;
  }

  .brand-short {
    display: inline;
  }

  .try-now-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  .locale-trigger-code {
    display: none;
  }

  .locale-trigger {
    padding: 8px 10px;
  }
}
</style>
