<template>
  <RouterLink :class="['card', 'practice-card', { highlighted }]" :to="practicePathCanonicalPath">
    <RomiAvatar :practice-path="practicePath" :size="68" :alt="avatarAlt" />

    <div class="info">
      <div class="title-row">
        <div class="h3 title">{{ title }}</div>
        <span class="go" aria-hidden="true">↗</span>
      </div>
      <p class="muted subtitle">{{ subtitle }}</p>
      <p class="muted description">{{ description }}</p>
      <div v-if="tags.length" class="tags">
        <span v-for="tag in tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
  </RouterLink>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import RomiAvatar from './RomiAvatar.vue';
import { getPracticePathCanonicalPath } from '../data/practicePathSlugs.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  practicePath: { type: Object, required: true },
  highlighted: { type: Boolean, default: false }
});

const { t } = useI18n();
const title = computed(() => `${t(`languageName.${props.practicePath.baseLanguage}`)} → ${t(`languageName.${props.practicePath.targetLanguage}`)}`);
const subtitle = computed(() => t('practice.cardSubtitle'));
const description = computed(() => props.practicePath?.description || t('practice.cardDescription'));
const tags = computed(() => Array.isArray(props.practicePath?.tags) ? props.practicePath.tags.slice(0, 3) : []);
const practicePathCanonicalPath = computed(() => getPracticePathCanonicalPath(props.practicePath));
const avatarAlt = computed(() => `Romi for ${title.value}`);
</script>

<style scoped>
.practice-card {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 16px 18px;
  align-items: start;
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

.subtitle,
.description {
  margin: 0;
  line-height: 1.5;
}

.subtitle {
  margin-top: 6px;
  font-size: 14px;
}

.description {
  margin-top: 6px;
  font-size: 14px;
}

.tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  background: color-mix(in srgb, var(--surface) 66%, var(--bg));
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
</style>
