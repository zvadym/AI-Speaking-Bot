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
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  display: flex;
  justify-content: center;
  padding: 0 18px;
  z-index: 18;
  pointer-events: none;
}

.dock {
  pointer-events: auto;
  width: min(560px, 100%);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(248, 251, 255, 0.74);
  box-shadow: 0 24px 65px rgba(40, 58, 87, 0.18);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.dock-item {
  border: 0;
  background: transparent;
  border-radius: 20px;
  min-height: 58px;
  color: var(--muted);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 5px;
  transition: background-color 180ms ease, color 180ms ease, transform 180ms ease;
  cursor: pointer;
}

.dock-item:hover,
.dock-item:focus-visible {
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink);
}

.dock-item:active {
  transform: translateY(1px);
}

.dock-item.active {
  color: var(--accent-strong);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(124, 197, 255, 0.22), transparent 50%),
    rgba(255, 255, 255, 0.8);
}

.dock-icon {
  width: 18px;
  height: 18px;
}

.dock-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

@media (min-width: 768px) {
  .dock-item {
    min-height: 62px;
  }
}
</style>
