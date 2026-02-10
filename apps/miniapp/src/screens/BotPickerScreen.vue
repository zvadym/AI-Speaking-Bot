<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="kicker">{{ $t('botPicker.kicker') }}</div>
      <h1>{{ $t('botPicker.title') }}</h1>
      <p class="sub">{{ $t('botPicker.sub') }}</p>
    </header>

    <section class="list" v-if="normalizedBots.length">
      <button
        v-for="bot in normalizedBots"
        :key="bot.bot_key"
        class="row"
        type="button"
        @click="emit('select', bot.bot_key)"
      >
        <div class="left">
          <div class="title">{{ bot.title }}</div>
          <div class="hint">{{ bot.subtitle }}</div>
        </div>
        <span class="arrow" aria-hidden="true">→</span>
      </button>
    </section>

    <section v-else class="empty">
      <p>{{ $t('botPicker.empty') }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from '../i18n.js';

const props = defineProps({
  bots: { type: Array, default: () => [] }
});

const emit = defineEmits(['select']);
const { t } = useI18n({ useScope: 'global' });

function languageLabelForCode(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return '';
  if (code === 'de') return t('practiceLanguages.de');
  if (code === 'en') return t('practiceLanguages.en');
  return code.toUpperCase();
}

const normalizedBots = computed(() =>
  (Array.isArray(props.bots) ? props.bots : [])
    .map((row) => {
      const botKey = (row?.bot_key || '').toString().trim().toLowerCase();
      if (!botKey) return null;
      const lang = (row?.target_lang || '').toString().trim().toLowerCase();
      const [baseCode, targetCode] = botKey.split('-');
      const learningCode = targetCode || lang;
      const baseLabel = languageLabelForCode(baseCode);
      const learningLabel = languageLabelForCode(learningCode);
      return {
        bot_key: botKey,
        title: learningLabel || t('botPicker.title'),
        subtitle: baseLabel && learningLabel ? `${baseLabel} → ${learningLabel}` : learningLabel || baseLabel || t('botPicker.sub')
      };
    })
    .filter(Boolean)
);
</script>

<style scoped>
.shell {
  width: min(900px, 100%);
  padding: 44px 22px 76px;
  display: grid;
  gap: 22px;
}

.hero {
  display: grid;
  gap: 10px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

h1 {
  font-family: var(--font-display);
  margin: 0;
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: -0.02em;
  line-height: 1;
}

.sub {
  margin: 0;
  max-width: 62ch;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
}

.list {
  display: grid;
  gap: 12px;
}

.row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 16px 38px var(--shadow);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.row:active {
  transform: translateY(2px);
  box-shadow: 0 12px 26px var(--shadow);
}

.left {
  display: grid;
  gap: 4px;
}

.title {
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 1;
}

.hint,
.empty {
  color: var(--muted);
  font-size: 13px;
}

.arrow {
  color: var(--accent-2);
  font-weight: 700;
}
</style>
