<template>
  <section class="page">
    <div class="container">
      <header class="page-hero">
        <p class="eyebrow">{{ t('nav.practice') }}</p>
        <h1 class="h1">{{ t('practice.title') }}</h1>
        <p class="muted sub">{{ t('practice.subhead') }}</p>
      </header>

      <div v-if="sections.length" class="sections">
        <section
          v-for="section in sections"
          :key="section.code"
          :class="['practice-section', { primary: section.isPrimary }]"
        >
          <header class="section-head">
            <h2 class="h3 section-title">{{ t('practice.basePathsHeading', { language: section.label }) }}</h2>
            <p class="muted section-sub">
              {{ t(section.targetSummary ? 'practice.basePathsSubhead' : 'practice.basePathsSubheadFallback', { language: section.label, targets: section.targetSummary }) }}
            </p>
            <div v-if="section.targetLanguages?.length" class="section-language-pills">
              <button
                v-for="target in section.targetLanguages"
                :key="`${section.code}-${target.code}`"
                type="button"
                class="section-language-pill"
                :class="{ active: activeTargetCodeFor(section.code) === target.code }"
                :aria-pressed="activeTargetCodeFor(section.code) === target.code ? 'true' : 'false'"
                @click="toggleTarget(section.code, target.code)"
              >
                {{ target.label }}
              </button>
            </div>
          </header>
          <TransitionGroup name="path-list" tag="div" class="grid-2 list">
            <PracticePathCard
              v-for="practicePath in sortedPracticePathsFor(section)"
              :key="practicePath.slug"
              :practice-path="practicePath"
              :highlighted="isPracticePathHighlighted(section, practicePath)"
            />
          </TransitionGroup>
        </section>
      </div>

      <p v-if="!sections.length" class="muted empty">
        {{ t('practice.empty') }}
      </p>
    </div>
  </section>
</template>

<script setup>
import PracticePathCard from '../components/PracticePathCard.vue';
import { practicePaths } from '../data/practicePaths.js';
import { useI18n } from '../i18n.js';
import { usePracticePathSections } from '../lib/usePracticePathSections.js';
import { usePracticePathTargetSort } from '../lib/usePracticePathTargetSort.js';

const { t, locale } = useI18n();
const { sections } = usePracticePathSections(practicePaths, locale, t);
const { activeTargetCodeFor, toggleTarget, sortedPracticePathsFor, isPracticePathHighlighted } = usePracticePathTargetSort();
</script>

<style scoped>
.page {
  padding: 68px 0 84px;
}

.page-hero {
  display: grid;
  gap: 14px;
  max-width: 70ch;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.sub {
  max-width: 62ch;
  margin: 0;
  font-size: 18px;
  line-height: 1.7;
}

.sections {
  margin-top: 34px;
  display: grid;
  gap: 34px;
}

.practice-section {
  display: grid;
  gap: 18px;
  padding: 28px;
  border: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
  border-radius: var(--radius-xxl);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.46)),
    color-mix(in srgb, var(--surface) 56%, var(--bg));
  box-shadow:
    var(--shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
}

.practice-section.primary {
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, #229ed9 10%, var(--surface)), color-mix(in srgb, #229ed9 4%, var(--bg)));
}

.section-head {
  display: grid;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: clamp(21px, 2.2vw, 29px);
}

.section-sub {
  margin: 0;
  max-width: 64ch;
  line-height: 1.55;
}

.section-language-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.section-language-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  background: color-mix(in srgb, var(--surface) 66%, var(--bg));
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  appearance: none;
}

.section-language-pill.active {
  border-color: color-mix(in srgb, #229ed9 45%, var(--border));
  background: radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 12%, transparent), transparent 55%), color-mix(in srgb, var(--surface) 66%, var(--bg));
  color: color-mix(in srgb, #229ed9 85%, var(--fg));
}

.path-list-move {
  transition: transform 620ms var(--motion-spring);
}

.path-list-enter-active,
.path-list-leave-active {
  transition:
    opacity 520ms var(--motion-spring),
    transform 520ms var(--motion-spring);
}

.path-list-enter-from,
.path-list-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.list {
  margin-top: 0;
  gap: 14px;
}

.empty {
  margin-top: 26px;
}
</style>
