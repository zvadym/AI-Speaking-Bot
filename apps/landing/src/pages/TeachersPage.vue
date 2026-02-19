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
import { computed } from 'vue';
import TeacherCard from '../components/TeacherCard.vue';
import { teachers } from '../data/teachers.js';
import { useI18n } from '../i18n.js';

const { t, locale } = useI18n();

function normalizeLanguageCode(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

function languageLabelForCode(codeRaw) {
  const code = normalizeLanguageCode(codeRaw);
  if (!code) return '';
  const key = `languageName.${code}`;
  const label = t(key);
  if (label !== key) return label;
  return code.toUpperCase();
}

function formatLanguageList(labelsInput) {
  const labels = Array.isArray(labelsInput) ? labelsInput.filter(Boolean) : [];
  if (!labels.length) return '';
  try {
    return new Intl.ListFormat(locale.value || 'en', { style: 'long', type: 'conjunction' }).format(labels);
  } catch {
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
    const first = labels.slice(0, -1).join(', ');
    return `${first}, ${labels[labels.length - 1]}`;
  }
}

const normalizedTeachers = computed(() =>
  (Array.isArray(teachers) ? teachers : [])
    .map((teacher) => {
      const baseCodeFromTeacher = normalizeLanguageCode(teacher?.baseLanguage);
      const botKey = (teacher?.botKey || '').toString().trim().toLowerCase();
      const [baseCodeFromBotKey] = botKey.split('-');
      const baseCode = baseCodeFromTeacher || normalizeLanguageCode(baseCodeFromBotKey) || 'en';
      return { ...teacher, baseCode };
    })
);

const sections = computed(() => {
  const currentLocaleCode = normalizeLanguageCode(locale.value);
  const grouped = new Map();
  for (const teacher of normalizedTeachers.value) {
    if (!grouped.has(teacher.baseCode)) grouped.set(teacher.baseCode, []);
    grouped.get(teacher.baseCode).push(teacher);
  }

  return Array.from(grouped.entries())
    .map(([code, rows]) => {
      const learningCodes = Array.from(
        new Set(rows.map((row) => normalizeLanguageCode(row?.learningLanguage)).filter(Boolean))
      );
      const learningLabels = learningCodes
        .map((learningCode) => languageLabelForCode(learningCode))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return {
        code,
        label: languageLabelForCode(code),
        learningLabels,
        learningSummary: formatLanguageList(learningLabels),
        isPrimary: code === currentLocaleCode,
        teachers: rows.slice().sort((a, b) => {
          const aName = (a?.displayName?.[locale.value] || a?.displayName?.en || a?.slug || '').toString();
          const bName = (b?.displayName?.[locale.value] || b?.displayName?.en || b?.slug || '').toString();
          const byName = aName.localeCompare(bName);
          if (byName !== 0) return byName;
          return (a.slug || '').toString().localeCompare((b.slug || '').toString());
        })
      };
    })
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
});
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
