<template>
  <section
    class="glass-card"
    :class="[toneClass, { interactive }]"
  >
    <slot />
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  tone: { type: String, default: 'default' },
  interactive: { type: Boolean, default: false }
});

const toneClass = computed(() => {
  if (props.tone === 'accent') return 'glass-card--accent';
  if (props.tone === 'subtle') return 'glass-card--subtle';
  if (props.tone === 'success') return 'glass-card--success';
  if (props.tone === 'warning') return 'glass-card--warning';
  return 'glass-card--default';
});
</script>

<style scoped>
.glass-card {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: var(--glass-surface);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}

.glass-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.56), rgba(255, 255, 255, 0.12) 42%, transparent 78%);
  pointer-events: none;
  opacity: 0.9;
}

.glass-card--subtle {
  background: var(--glass-surface-strong);
}

.glass-card--accent {
  background:
    radial-gradient(120% 160% at 0% 0%, rgba(124, 197, 255, 0.28), transparent 52%),
    radial-gradient(120% 160% at 100% 100%, rgba(58, 164, 148, 0.18), transparent 48%),
    var(--glass-surface-strong);
}

.glass-card--success {
  background:
    radial-gradient(120% 150% at 0% 0%, rgba(45, 184, 122, 0.22), transparent 48%),
    var(--glass-surface-strong);
}

.glass-card--warning {
  background:
    radial-gradient(120% 150% at 100% 0%, rgba(245, 166, 35, 0.22), transparent 48%),
    var(--glass-surface-strong);
}

.interactive {
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  cursor: pointer;
}

.interactive:hover {
  transform: translateY(-1px);
  box-shadow: 0 26px 70px rgba(43, 61, 90, 0.16);
  border-color: rgba(122, 154, 196, 0.34);
}

.interactive:active {
  transform: translateY(1px);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-card,
  .glass-card--subtle,
  .glass-card--accent,
  .glass-card--success,
  .glass-card--warning {
    background: rgba(255, 255, 255, 0.94);
  }
}
</style>
