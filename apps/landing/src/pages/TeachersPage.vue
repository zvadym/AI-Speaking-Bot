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
            <h2 class="h3 section-title">{{ t('teachers.baseTeachersHeading', { language: section.label }) }}</h2>
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
    .map(([code, rows]) => ({
      code,
      label: languageLabelForCode(code),
      isPrimary: code === currentLocaleCode,
      teachers: rows.slice().sort((a, b) => {
        const aName = (a?.displayName?.[locale.value] || a?.displayName?.en || a?.slug || '').toString();
        const bName = (b?.displayName?.[locale.value] || b?.displayName?.en || b?.slug || '').toString();
        const byName = aName.localeCompare(bName);
        if (byName !== 0) return byName;
        return (a.slug || '').toString().localeCompare((b.slug || '').toString());
      })
    }))
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: clamp(20px, 2.2vw, 28px);
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
