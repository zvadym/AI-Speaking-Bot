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
  border-radius: 18px;
  border: 1px solid var(--glass-border);
  background: var(--glass-surface);
  box-shadow: var(--shadow);
}

.glass-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.46), rgba(255, 255, 255, 0.12) 58%, transparent 100%);
  pointer-events: none;
  opacity: 0.55;
}

.glass-card--subtle {
  background: var(--glass-surface-strong);
}

.glass-card--accent {
  background:
    radial-gradient(120% 160% at 0% 0%, rgba(127, 150, 128, 0.16), transparent 52%),
    radial-gradient(120% 160% at 100% 100%, rgba(205, 181, 156, 0.12), transparent 48%),
    var(--glass-surface-strong);
}

.glass-card--success {
  background:
    radial-gradient(120% 150% at 0% 0%, rgba(103, 130, 102, 0.14), transparent 48%),
    var(--glass-surface-strong);
}

.glass-card--warning {
  background:
    radial-gradient(120% 150% at 100% 0%, rgba(181, 109, 86, 0.14), transparent 48%),
    var(--glass-surface-strong);
}

.interactive {
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease, background-color 180ms ease;
  cursor: pointer;
}

.interactive:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
  border-color: rgba(127, 150, 128, 0.4);
  background: rgba(251, 247, 239, 0.98);
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
    background: rgba(250, 246, 239, 0.98);
  }
}
</style>
