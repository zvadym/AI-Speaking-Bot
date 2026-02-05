<template>
  <div class="footer">
    <button class="back" type="button" @click="goHome">
      <span class="icon" aria-hidden="true">←</span>
      <span>{{ $t('common.backToMenu') }}</span>
    </button>
  </div>
</template>

<script setup>
import { track } from '../lib/analytics.js';

const emit = defineEmits(['navigate']);

function goHome() {
  track('ui_click', { id: 'back_to_menu', to: '/' });
  emit('navigate', '/');
}
</script>

<style scoped>
.footer {
  display: grid;
  justify-items: stretch;
  margin-top: 6px;
}

.back {
  width: 100%;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 18px 40px rgba(30, 26, 22, 0.12);
  padding: 12px 14px;
  border-radius: 16px;
  cursor: pointer;
  font-weight: 750;
  letter-spacing: 0.01em;
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.back:active {
  transform: translateY(1px);
  box-shadow: 0 12px 28px rgba(30, 26, 22, 0.12);
}

.icon {
  opacity: 0.75;
}
</style>
