<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click="onOverlayClick">
      <div
        ref="dialogRef"
        class="drawer"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @click.stop
        @keydown.esc.prevent="close"
      >
        <header class="drawer-head">
          <h2 :id="titleId" class="h3 title">{{ title }}</h2>
          <button ref="closeBtnRef" class="icon-btn" type="button" :aria-label="t('cta.close')" @click="close">
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div class="drawer-body">
          <nav class="nav" :aria-label="title">
            <div class="nav-group">
              <RouterLink
                v-for="item in primaryItems"
                :key="item.key"
                class="nav-link"
                :class="{ active: item.active }"
                :to="item.to"
                @click="close"
              >
                {{ item.label }}
              </RouterLink>
            </div>

            <div v-if="secondaryItems.length" class="nav-group secondary">
              <RouterLink
                v-for="item in secondaryItems"
                :key="item.key"
                class="nav-link"
                :class="{ active: item.active }"
                :to="item.to"
                @click="close"
              >
                {{ item.label }}
              </RouterLink>
            </div>
          </nav>

          <div class="cta">
            <button class="btn primary try" type="button" @click="emit('try')">
              <span class="telegram-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
                  <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
                </svg>
              </span>
              <span>{{ t('cta.tryNow') }}</span>
            </button>
            <p class="muted cta-sub">{{ t('home.tryModalSubhead') }}</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  primaryItems: {
    type: Array,
    default: () => []
  },
  secondaryItems: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:open', 'try']);

const { t } = useI18n();

const dialogRef = ref(null);
const closeBtnRef = ref(null);
const titleId = 'mobile-menu-title';
const previousOverflow = ref('');

const openState = computed(() => !!props.open);

useFocusTrap({
  active: openState,
  containerRef: dialogRef,
  initialFocusRef: closeBtnRef
});

function close() {
  emit('update:open', false);
}

function onOverlayClick(event) {
  if (event.target !== event.currentTarget) return;
  close();
}

function lockBodyScroll() {
  if (!import.meta.client) return;
  previousOverflow.value = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  if (!import.meta.client) return;
  document.body.style.overflow = previousOverflow.value;
}

watch(
  openState,
  (isOpen) => {
    if (!import.meta.client) return;
    if (isOpen) lockBodyScroll();
    else unlockBodyScroll();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  unlockBodyScroll();
});
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--fg) 50%, transparent);
  backdrop-filter: blur(10px);
}

.drawer {
  width: min(360px, 92vw);
  height: 100%;
  background: var(--bg);
  border-left: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  box-shadow: -24px 0 80px rgba(8, 12, 22, 0.22);
  display: grid;
  grid-template-rows: auto 1fr;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
}

.title {
  margin: 0;
  font-size: 18px;
  line-height: 1.1;
}

.icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  background: color-mix(in srgb, var(--surface) 60%, var(--bg));
  color: var(--fg);
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
}

.drawer-body {
  padding: 14px 16px 18px;
  display: grid;
  gap: 18px;
  overflow: auto;
}

.nav {
  display: grid;
  gap: 12px;
}

.nav-group {
  display: grid;
  gap: 8px;
}

.nav-group.secondary {
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
}

.nav-link {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg) 84%, var(--surface));
  font-weight: 800;
  text-decoration: none;
  transition: border-color 140ms ease, transform 140ms ease, background-color 140ms ease;
}

.nav-link:hover {
  text-decoration: none;
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
  transform: translateY(-1px);
}

.nav-link.active {
  border-color: color-mix(in srgb, #229ed9 32%, var(--border));
  background:
    radial-gradient(140% 140% at 10% 10%, color-mix(in srgb, #229ed9 14%, transparent), transparent 55%),
    color-mix(in srgb, var(--bg) 84%, var(--surface));
}

.cta {
  display: grid;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
}

.try {
  min-height: 44px;
  width: 100%;
  justify-content: center;
}

.telegram-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: #fff;
}

.telegram-mark svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.cta-sub {
  margin: 0;
  line-height: 1.5;
  font-size: 13px;
}
</style>
