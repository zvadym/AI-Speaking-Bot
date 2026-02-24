import { ref } from 'vue';

function normalizeLanguageCode(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

export function useTeacherLearningTargetSort() {
  const activeLearningBySection = ref({});

  function reset() {
    activeLearningBySection.value = {};
  }

  function activeLearningCodeFor(sectionCode) {
    return (activeLearningBySection.value?.[sectionCode] || '').toString();
  }

  function toggleLearningTarget(sectionCode, learningCode) {
    const normalized = normalizeLanguageCode(learningCode);
    const current = normalizeLanguageCode(activeLearningCodeFor(sectionCode));
    if (normalized && normalized === current) {
      const { [sectionCode]: _omitted, ...rest } = activeLearningBySection.value || {};
      activeLearningBySection.value = rest;
      return;
    }
    activeLearningBySection.value = {
      ...(activeLearningBySection.value || {}),
      [sectionCode]: normalized
    };
  }

  function isTeacherHighlighted(section, teacher) {
    const selected = normalizeLanguageCode(activeLearningCodeFor(section.code));
    if (!selected) return false;
    return normalizeLanguageCode(teacher?.learningLanguage) === selected;
  }

  function sortedTeachersFor(section) {
    const selected = normalizeLanguageCode(activeLearningCodeFor(section.code));
    if (!selected) return section.teachers;
    const rows = Array.isArray(section.teachers) ? section.teachers : [];
    return rows
      .map((teacher, idx) => ({ teacher, idx }))
      .sort((a, b) => {
        const aMatches = normalizeLanguageCode(a.teacher?.learningLanguage) === selected;
        const bMatches = normalizeLanguageCode(b.teacher?.learningLanguage) === selected;
        if (aMatches !== bMatches) return aMatches ? -1 : 1;
        return a.idx - b.idx;
      })
      .map((row) => row.teacher);
  }

  return {
    activeLearningBySection,
    reset,
    activeLearningCodeFor,
    toggleLearningTarget,
    isTeacherHighlighted,
    sortedTeachersFor
  };
}

