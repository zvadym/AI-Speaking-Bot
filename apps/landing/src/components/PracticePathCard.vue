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
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-xl);
  padding: 6px;
  background: var(--surface);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition:
    transform 220ms var(--motion-soft),
    box-shadow 220ms var(--motion-soft),
    background-color 220ms var(--motion-soft);
}

.practice-card-core {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px 16px;
  align-items: center;
  padding: 18px;
  border-radius: calc(var(--radius-xl) - 8px);
  background: var(--surface);
  box-shadow: none;
}

.practice-card.highlighted {
  border-color: var(--fg);
  background: color-mix(in srgb, var(--accent) 18%, var(--surface));
  box-shadow:
    6px 6px 0 var(--fg),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 54%, transparent);
}

.practice-card:hover {
  text-decoration: none;
  transform: translate(-2px, -2px);
  box-shadow: 8px 8px 0 var(--fg);
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
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 38%, var(--surface));
  border: 1.5px solid var(--fg);
  box-shadow: none;
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
