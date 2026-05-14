<template>
  <RouterLink :class="['practice-card', { highlighted }]" :to="practicePathCanonicalPath">
    <div class="practice-card-core">
      <div class="flag-badge" :aria-label="title">{{ flag }}</div>

      <div class="info">
        <div class="title-row">
          <div class="h3 title">{{ title }}</div>
          <span class="go" aria-hidden="true">↗</span>
        </div>
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
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: var(--radius-xl);
  padding: 6px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.30)),
    color-mix(in srgb, var(--surface) 70%, var(--bg));
  box-shadow:
    var(--shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  text-decoration: none;
  transition:
    transform 620ms var(--motion-spring),
    border-color 620ms var(--motion-spring),
    box-shadow 620ms var(--motion-spring),
    background-color 620ms var(--motion-spring);
}

.practice-card-core {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px 16px;
  align-items: center;
  padding: 18px;
  border-radius: calc(var(--radius-xl) - 8px);
  background:
    linear-gradient(135deg, rgba(34, 158, 217, 0.07), transparent 44%),
    color-mix(in srgb, var(--surface) 58%, var(--bg));
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.82);
}

.practice-card.highlighted {
  border-color: color-mix(in srgb, #229ed9 40%, var(--border));
  box-shadow:
    0 16px 34px color-mix(in srgb, #229ed9 14%, transparent),
    0 0 0 1px color-mix(in srgb, #229ed9 18%, transparent);
}

.practice-card:hover {
  text-decoration: none;
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--fg) 20%, var(--border));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--fg) 10%, transparent);
}

.practice-card:active {
  transform: translateY(0) scale(0.995);
}

.practice-card:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}

.info {
  min-width: 0;
}

.flag-badge {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 16px;
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
