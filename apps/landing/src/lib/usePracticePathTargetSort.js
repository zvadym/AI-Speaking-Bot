import { ref } from 'vue';

function normalizeLanguageCode(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

export function usePracticePathTargetSort() {
  const activeTargetsBySection = ref({});

  function activeTargetCodeFor(sectionCode) {
    const code = normalizeLanguageCode(sectionCode);
    return code ? activeTargetsBySection.value[code] || '' : '';
  }

  function toggleTarget(sectionCode, targetCode) {
    const code = normalizeLanguageCode(sectionCode);
    const target = normalizeLanguageCode(targetCode);
    if (!code || !target) return;
    activeTargetsBySection.value = {
      ...activeTargetsBySection.value,
      [code]: activeTargetsBySection.value[code] === target ? '' : target
    };
  }

  function isPracticePathHighlighted(section, practicePath) {
    const selected = activeTargetCodeFor(section?.code);
    if (!selected) return false;
    return normalizeLanguageCode(practicePath?.targetLanguage) === selected;
  }

  function sortedPracticePathsFor(section) {
    const selected = activeTargetCodeFor(section?.code);
    const rows = Array.isArray(section?.practicePaths) ? section.practicePaths : [];
    if (!selected) return rows;
    return rows
      .map((practicePath, idx) => ({ practicePath, idx }))
      .sort((a, b) => {
        const aMatches = normalizeLanguageCode(a.practicePath?.targetLanguage) === selected;
        const bMatches = normalizeLanguageCode(b.practicePath?.targetLanguage) === selected;
        if (aMatches !== bMatches) return aMatches ? -1 : 1;
        return a.idx - b.idx;
      })
      .map((row) => row.practicePath);
  }

  function reset() {
    activeTargetsBySection.value = {};
  }

  return {
    activeTargetCodeFor,
    toggleTarget,
    isPracticePathHighlighted,
    sortedPracticePathsFor,
    reset
  };
}
