<template>
  <label class="bot-switcher">
    <span class="bot-switcher-label">{{ label }}</span>
    <select
      class="bot-switcher-select"
      :value="modelValue"
      @change="emit('update:modelValue', $event.target.value)"
    >
      <option
        v-for="bot in normalizedBots"
        :key="bot.bot_key"
        :value="bot.bot_key"
      >
        {{ bot.title }}
      </option>
    </select>
  </label>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from '../i18n.js';

const props = defineProps({
  bots: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  label: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n({ useScope: 'global' });

function languageLabelForCode(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return '';
  const key = `practiceLanguages.${code}`;
  const translated = t(key);
  return translated !== key ? translated : code.toUpperCase();
}

const normalizedBots = computed(() =>
  (Array.isArray(props.bots) ? props.bots : [])
    .map((row) => {
      const botKey = (row?.bot_key || '').toString().trim().toLowerCase();
      if (!botKey) return null;
      const learning = languageLabelForCode(row?.learning_language || row?.target_lang || botKey.split('-')[1]);
      const title = (row?.bot_name || '').toString().trim() || learning;
      return {
        bot_key: botKey,
        title: learning ? `${title} · ${learning}` : title
      };
    })
    .filter(Boolean)
);
</script>

<style scoped>
.bot-switcher {
  display: grid;
  gap: 8px;
}

.bot-switcher-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.01em;
}

.bot-switcher-select {
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(131, 150, 179, 0.28);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  padding: 14px 16px;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  outline: none;
}

.bot-switcher-select:focus-visible {
  border-color: rgba(81, 156, 245, 0.6);
  box-shadow: 0 0 0 4px rgba(81, 156, 245, 0.16);
}
</style>
