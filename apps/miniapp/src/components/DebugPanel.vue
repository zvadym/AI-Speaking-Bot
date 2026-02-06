<template>
  <section class="debug-panel">
    <div class="debug-header">
      <strong>{{ title }}</strong>
      <button class="debug-clear" type="button" @click="$emit('clear')">Clear</button>
    </div>
    <div class="debug-body">
      <p class="debug-empty" v-if="!orderedLogs.length">No logs yet.</p>
      <pre class="debug-entry" v-for="entry in orderedLogs" :key="entry.id">{{ formatEntry(entry) }}</pre>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, default: 'Debug' },
  logs: { type: Array, default: () => [] }
});

defineEmits(['clear']);

const orderedLogs = computed(() => [...(props.logs || [])].reverse());

function formatEntry(entry) {
  const time = entry?.at ? entry.at.replace('T', ' ').replace('Z', '') : '';
  const event = entry?.event || 'event';
  const details = entry?.details || {};
  let detailsText = '';
  try {
    detailsText = JSON.stringify(details, null, 2);
  } catch {
    detailsText = String(details);
  }
  return `[${time}] ${event}\n${detailsText}`;
}
</script>

<style scoped>
.debug-panel {
  margin-top: 8px;
  border: 1px solid var(--stroke);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 10px 28px rgba(30, 26, 22, 0.08);
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--stroke);
  font-size: 12px;
  letter-spacing: 0.01em;
}

.debug-clear {
  border: 1px solid var(--stroke);
  background: #fff;
  border-radius: 8px;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.debug-body {
  max-height: 220px;
  overflow: auto;
  padding: 8px;
  display: grid;
  gap: 8px;
}

.debug-empty {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.debug-entry {
  margin: 0;
  padding: 10px;
  border: 1px solid var(--stroke);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
