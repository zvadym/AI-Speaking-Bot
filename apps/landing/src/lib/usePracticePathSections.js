import { computed } from 'vue';

function normalizeLanguageCode(input) {
  const raw = (input || '').toString().trim().toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

export function usePracticePathSections(practicePathsRaw, localeRef, t) {
  const practicePathsList = computed(() => (Array.isArray(practicePathsRaw) ? practicePathsRaw : []));

  function languageLabelForCode(codeRaw) {
    const code = normalizeLanguageCode(codeRaw);
    if (!code) return '';
    const key = `languageName.${code}`;
    const label = t(key);
    return label !== key ? label : code.toUpperCase();
  }

  function formatLanguageList(labelsInput) {
    const labels = Array.isArray(labelsInput) ? labelsInput.filter(Boolean) : [];
    if (!labels.length) return '';
    try {
      return new Intl.ListFormat(localeRef.value || 'en', { style: 'long', type: 'conjunction' }).format(labels);
    } catch {
      if (labels.length === 1) return labels[0];
      if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
      return `${labels.slice(0, -1).join(', ')}, ${labels[labels.length - 1]}`;
    }
  }

  const sections = computed(() => {
    const currentLocaleCode = normalizeLanguageCode(localeRef.value);
    const grouped = new Map();

    for (const practicePath of practicePathsList.value) {
      const baseCode = normalizeLanguageCode(practicePath?.baseLanguage) || 'en';
      if (!grouped.has(baseCode)) grouped.set(baseCode, []);
      grouped.get(baseCode).push(practicePath);
    }

    return Array.from(grouped.entries())
      .map(([code, rows]) => {
        const targetCodes = Array.from(new Set(rows.map((row) => normalizeLanguageCode(row?.targetLanguage)).filter(Boolean)));
        const targetLanguages = targetCodes
          .map((targetCode) => ({ code: targetCode, label: languageLabelForCode(targetCode) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return {
          code,
          label: languageLabelForCode(code),
          targetLanguages,
          targetSummary: formatLanguageList(targetLanguages.map((row) => row.label)),
          isPrimary: code === currentLocaleCode,
          practicePaths: rows.slice().sort((a, b) => {
            const aLabel = languageLabelForCode(a?.targetLanguage);
            const bLabel = languageLabelForCode(b?.targetLanguage);
            const byLabel = aLabel.localeCompare(bLabel);
            if (byLabel !== 0) return byLabel;
            return (a?.slug || '').toString().localeCompare((b?.slug || '').toString());
          })
        };
      })
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  });

  return { sections };
}
