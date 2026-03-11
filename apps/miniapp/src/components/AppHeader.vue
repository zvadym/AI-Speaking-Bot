<template>
  <header class="app-header">
    <div class="app-header-card">
      <div class="app-header-title">{{ $t('appHeader.title') }}</div>
      <button type="button" class="app-header-link" @click="openSchoolUrl">
        {{ $t('appHeader.linkLabel') }}
      </button>
      <p class="app-header-copy">{{ $t('appHeader.description') }}</p>
    </div>
  </header>
</template>

<script setup>
import { tgOpenLink } from '../lib/tg.js';

const schoolUrl = ((import.meta.env.VITE_SCHOOL_URL || 'https://ai-language-school.online/').toString()).trim();

function openSchoolUrl() {
  if (!schoolUrl) return;
  tgOpenLink(schoolUrl);
}
</script>

<style scoped>
.app-header {
  position: fixed;
  top: calc(10px + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  display: grid;
  justify-items: center;
  padding: 0 16px;
  z-index: 16;
  pointer-events: none;
}

.app-header-card {
  width: min(760px, 100%);
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(185, 176, 159, 0.7);
  background: rgba(249, 244, 237, 0.94);
  box-shadow: 0 12px 28px rgba(61, 52, 38, 0.08);
  display: grid;
  gap: 2px;
  pointer-events: auto;
}

.app-header-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--ink);
}

.app-header-link {
  width: fit-content;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.app-header-copy {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}
</style>
