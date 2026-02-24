import { computed } from 'vue';

function normalizeLanguageCode(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

export function useTeacherSections(teachersRaw, localeRef, t) {
  const teachersList = computed(() => (Array.isArray(teachersRaw) ? teachersRaw : []));

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
      return new Intl.ListFormat(localeRef.value || 'en', { style: 'long', type: 'conjunction' }).format(labels);
    } catch {
      if (labels.length === 1) return labels[0];
      if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
      const first = labels.slice(0, -1).join(', ');
      return `${first}, ${labels[labels.length - 1]}`;
    }
  }

  const normalizedTeachers = computed(() =>
    teachersList.value.map((teacher) => {
      const baseCodeFromTeacher = normalizeLanguageCode(teacher?.baseLanguage);
      const botKey = (teacher?.botKey || '').toString().trim().toLowerCase();
      const [baseCodeFromBotKey] = botKey.split('-');
      const baseCode = baseCodeFromTeacher || normalizeLanguageCode(baseCodeFromBotKey) || 'en';
      return { ...teacher, baseCode };
    })
  );

  const sections = computed(() => {
    const currentLocaleCode = normalizeLanguageCode(localeRef.value);
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
        const learningLanguages = learningCodes
          .map((learningCode) => ({
            code: learningCode,
            label: languageLabelForCode(learningCode)
          }))
          .filter((row) => row.code && row.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        const learningLabels = learningLanguages.map((row) => row.label);
        return {
          code,
          label: languageLabelForCode(code),
          learningLanguages,
          learningLabels,
          learningSummary: formatLanguageList(learningLabels),
          isPrimary: code === currentLocaleCode,
          teachers: rows.slice().sort((a, b) => {
            const aName = (a?.displayName?.[localeRef.value] || a?.displayName?.en || a?.slug || '').toString();
            const bName = (b?.displayName?.[localeRef.value] || b?.displayName?.en || b?.slug || '').toString();
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

  return {
    sections
  };
}
