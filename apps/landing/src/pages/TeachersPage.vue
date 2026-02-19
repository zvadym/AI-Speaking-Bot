<template>
  <section class="page">
    <div class="container">
      <header class="page-hero">
        <p class="eyebrow">{{ t('nav.teachers') }}</p>
        <h1 class="h1">{{ t('teachers.title') }}</h1>
        <p class="muted sub">{{ t('teachers.subhead') }}</p>
      </header>

      <div v-if="sections.length" class="sections">
        <section
          v-for="section in sections"
          :key="section.code"
          :class="['teachers-section', { primary: section.isPrimary }]"
        >
          <header class="section-head">
            <p class="section-eyebrow">{{ t('teachers.baseLanguageLabel') }}</p>
            <h2 class="h3 section-title">{{ t('teachers.baseTeachersHeading', { language: section.label }) }}</h2>
            <p class="muted section-sub">
              {{
                t(
                  section.learningSummary ? 'teachers.baseTeachersSubhead' : 'teachers.baseTeachersSubheadFallback',
                  { language: section.label, targets: section.learningSummary }
                )
              }}
            </p>
            <div v-if="section.learningLabels.length" class="section-language-pills">
              <span v-for="target in section.learningLabels" :key="`${section.code}-${target}`" class="section-language-pill">
                {{ target }}
              </span>
            </div>
          </header>
          <div class="grid-2 list">
            <TeacherCard v-for="teacher in section.teachers" :key="teacher.teacherKey || teacher.slug" :teacher="teacher" />
          </div>
        </section>
      </div>

      <p v-if="!sections.length" class="muted empty">
        {{ t('teachers.empty') }}
      </p>
    </div>
  </section>
</template>

<script setup>
import TeacherCard from '../components/TeacherCard.vue';
import { teachers } from '../data/teachers.js';
import { useI18n } from '../i18n.js';
import { useTeacherSections } from '../lib/teacherSections.js';

const { t, locale } = useI18n();

const { sections } = useTeacherSections(teachers, locale, t);
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

.teachers-section {
  display: grid;
  gap: 18px;
  padding: 22px 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 36%, var(--bg)), var(--bg));
}

.teachers-section.primary {
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, #229ed9 10%, var(--surface)),
      color-mix(in srgb, #229ed9 4%, var(--bg))
    );
}

.section-head {
  display: grid;
  gap: 10px;
}

.section-eyebrow {
  margin: 0;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  background: color-mix(in srgb, var(--surface) 76%, var(--bg));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
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
}

.list {
  margin-top: 0;
  gap: 14px;
}

.empty {
  margin-top: 26px;
}

@media (max-width: 620px) {
  .page {
    padding-top: 54px;
  }

  .sections {
    margin-top: 26px;
    gap: 20px;
  }

  .teachers-section {
    padding: 16px;
  }

  .sub {
    font-size: 16px;
  }
}
</style>
