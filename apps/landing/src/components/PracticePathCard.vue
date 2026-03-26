<template>
  <RouterLink :class="['card', 'practice-card', { highlighted }]" :to="practicePathCanonicalPath">
    <div class="flag-badge" :aria-label="title">{{ flag }}</div>

    <div class="info">
      <div class="title-row">
        <div class="h3 title">{{ title }}</div>
        <span class="go" aria-hidden="true">↗</span>
      </div>
    </div>
  </RouterLink>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { getPracticePathCanonicalPath } from '../data/practicePathSlugs.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  practicePath: { type: Object, required: true },
  highlighted: { type: Boolean, default: false }
});

const { t } = useI18n();
const title = computed(() => t(`languageName.${props.practicePath.targetLanguage}`));
const practicePathCanonicalPath = computed(() => getPracticePathCanonicalPath(props.practicePath));
const flag = computed(() => {
  const code = (props.practicePath?.targetLanguage || '').toString().trim().toLowerCase();
  const flagsByLanguage = {
    ar: '🇸🇦', de: '🇩🇪', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', hi: '🇮🇳', id: '🇮🇩',
    it: '🇮🇹', pl: '🇵🇱', pt: '🇵🇹', ru: '🇷🇺', tr: '🇹🇷', ua: '🇺🇦', uk: '🇺🇦'
  };
  return flagsByLanguage[code] || '🏳️';
});
</script>

<style scoped>
.practice-card {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px 16px;
  align-items: center;
  padding: 18px;
  transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.practice-card.highlighted {
  border-color: color-mix(in srgb, #229ed9 40%, var(--border));
  box-shadow:
    0 16px 34px color-mix(in srgb, #229ed9 14%, transparent),
    0 0 0 1px color-mix(in srgb, #229ed9 18%, transparent);
}

.practice-card:hover {
  text-decoration: none;
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--fg) 20%, var(--border));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--fg) 10%, transparent);
}

.info {
  min-width: 0;
}

.flag-badge {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--fg) 10%, transparent);
  font-size: 28px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title {
  margin: 0;
}

.go {
  margin-left: auto;
  line-height: 1;
  font-size: 16px;
  opacity: 0.7;
}
</style>
