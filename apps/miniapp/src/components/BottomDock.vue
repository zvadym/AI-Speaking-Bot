<template>
  <nav class="dock-wrap" aria-label="Primary">
    <div class="dock">
      <button
        v-for="item in items"
        :key="item.path"
        type="button"
        class="dock-item"
        :class="{ active: active === item.id }"
        @click="emit('navigate', item.path)"
      >
        <component :is="item.icon" class="dock-icon" :stroke-width="active === item.id ? 2.2 : 1.9" />
        <span class="dock-label">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue';
import { House, WalletCards, CircleUserRound, MessageSquareText } from 'lucide-vue-next';
import { useI18n } from '../i18n.js';

const props = defineProps({
  active: { type: String, default: 'home' }
});

const emit = defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const items = computed(() => ([
  { id: 'home', path: '/', label: t('dock.home'), icon: House },
  { id: 'subscription', path: '/subscription', label: t('dock.plan'), icon: WalletCards },
  { id: 'profile', path: '/profile', label: t('dock.profile'), icon: CircleUserRound },
  { id: 'feedback', path: '/feedback', label: t('dock.support'), icon: MessageSquareText }
]));
</script>

<style scoped>
.dock-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex;
  justify-content: center;
  padding: 0 12px;
  z-index: 18;
  pointer-events: none;
}

.dock {
  pointer-events: auto;
  width: min(840px, 100%);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
  border-radius: 22px;
  border: 1px solid rgba(186, 177, 160, 0.62);
  background: rgba(249, 245, 238, 0.82);
  box-shadow: 0 12px 28px rgba(61, 52, 38, 0.09);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.dock-item {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 14px;
  min-height: 50px;
  color: var(--muted);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 4px;
  transition: background-color 180ms ease, color 180ms ease, transform 180ms ease, border-color 180ms ease;
  cursor: pointer;
}

.dock-item:hover,
.dock-item:focus-visible {
  background: rgba(255, 255, 255, 0.65);
  color: var(--ink);
}

.dock-item:active {
  transform: translateY(1px);
}

.dock-item.active {
  color: var(--accent-strong);
  border-color: rgba(127, 150, 128, 0.26);
  background: rgba(255, 255, 255, 0.78);
}

.dock-icon {
  width: 17px;
  height: 17px;
}

.dock-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

@media (min-width: 768px) {
  .dock-item {
    min-height: 54px;
  }
}
</style>
