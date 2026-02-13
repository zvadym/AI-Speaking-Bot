<template>
  <section class="page">
    <div class="container">
      <h1 class="h1">{{ t('teachers.title') }}</h1>
      <p class="muted sub">{{ t('teachers.subhead') }}</p>

      <div v-if="primarySection" class="sections">
        <section
          v-for="section in visibleSections"
          :key="section.code"
          class="teachers-section"
        >
          <h2 class="h3 section-title">{{ t('teachers.baseTeachersHeading', { language: section.label }) }}</h2>
          <div class="grid-2 list">
            <TeacherCard v-for="teacher in section.teachers" :key="teacher.slug" :teacher="teacher" />
          </div>
        </section>
      </div>

      <button
        v-if="hasSecondarySections"
        class="show-more"
        type="button"
        @click="toggleShowMore"
      >
        {{ showMore ? t('teachers.showLessTeachers') : t('teachers.showMoreTeachers') }}
      </button>

      <p v-if="!primarySection" class="muted empty">
        {{ t('teachers.empty') }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import TeacherCard from '../components/TeacherCard.vue';
import { teachers } from '../data/teachers.js';
import { useI18n } from '../i18n.js';

const { t, locale } = useI18n();
const showMore = ref(false);

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
  const grouped = new Map();
  for (const teacher of normalizedTeachers.value) {
    if (!grouped.has(teacher.baseCode)) grouped.set(teacher.baseCode, []);
    grouped.get(teacher.baseCode).push(teacher);
  }

  return Array.from(grouped.entries())
    .map(([code, rows]) => ({
      code,
      label: languageLabelForCode(code),
      teachers: rows.slice().sort((a, b) => {
        const aName = (a?.displayName?.[locale.value] || a?.displayName?.en || a?.slug || '').toString();
        const bName = (b?.displayName?.[locale.value] || b?.displayName?.en || b?.slug || '').toString();
        const byName = aName.localeCompare(bName);
        if (byName !== 0) return byName;
        return (a.slug || '').toString().localeCompare((b.slug || '').toString());
      })
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const primarySectionCode = computed(() => {
  const availableCodes = sections.value.map((section) => section.code);
  if (!availableCodes.length) return '';

  const currentLocaleCode = normalizeLanguageCode(locale.value);
  if (currentLocaleCode && availableCodes.includes(currentLocaleCode)) return currentLocaleCode;
  if (availableCodes.includes('en')) return 'en';
  return availableCodes.slice().sort((a, b) => a.localeCompare(b))[0];
});

const primarySection = computed(() =>
  sections.value.find((section) => section.code === primarySectionCode.value) || null
);

const secondarySections = computed(() =>
  sections.value
    .filter((section) => section.code !== primarySectionCode.value)
    .sort((a, b) => a.label.localeCompare(b.label))
);

const hasSecondarySections = computed(() => secondarySections.value.length > 0);

const visibleSections = computed(() => {
  if (!primarySection.value) return [];
  if (!showMore.value) return [primarySection.value];
  return [primarySection.value, ...secondarySections.value];
});

watch(primarySectionCode, () => {
  showMore.value = false;
});

function toggleShowMore() {
  showMore.value = !showMore.value;
}
</script>

<style scoped>
.page {
  padding: 56px 0;
}

.sub {
  max-width: 66ch;
  margin-top: 10px;
  font-size: 18px;
  line-height: 1.6;
}

.sections {
  margin-top: 22px;
  display: grid;
  gap: 26px;
}

.teachers-section {
  display: grid;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 20px;
}

.list {
  margin-top: 0;
}

.show-more {
  margin-top: 18px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  border-radius: 999px;
  padding: 10px 14px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.show-more:hover {
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

.empty {
  margin-top: 22px;
}
</style>
