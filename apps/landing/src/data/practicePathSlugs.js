import { practicePaths, getPracticePathByLegacyAlias, getPracticePathBySlug } from './practicePaths.js';
import { resolveTeacherRouteBySlug } from './teacherSlugs.js';
import { normalizeLocale } from '../i18n.js';

function normalizeSlug(input) {
  return (input || '').toString().trim().toLowerCase();
}

export function getPracticePathCanonicalLocale(practicePath) {
  return normalizeLocale(practicePath?.canonicalLocale || practicePath?.baseLanguage) || 'en';
}

export function getPracticePathCanonicalPathSuffix(practicePath) {
  const slug = normalizeSlug(practicePath?.slug);
  if (!slug) return '/practice';
  return `/practice/${encodeURIComponent(slug)}`;
}

export function getPracticePathCanonicalPath(practicePath) {
  const locale = getPracticePathCanonicalLocale(practicePath);
  return `/${locale}${getPracticePathCanonicalPathSuffix(practicePath)}`;
}

export function resolvePracticePathRouteBySlug(requestedLocale, slugInput) {
  const requested = normalizeLocale(requestedLocale) || '';
  const slug = normalizeSlug(slugInput);
  if (!slug) return null;

  const direct = getPracticePathBySlug(slug) || getPracticePathByLegacyAlias(slug);
  if (direct) {
    const canonicalLocale = getPracticePathCanonicalLocale(direct);
    const canonicalPath = getPracticePathCanonicalPath(direct);
    return {
      practicePath: direct,
      canonicalLocale,
      canonicalPath,
      isCanonicalRequest: requested === canonicalLocale && slug === normalizeSlug(direct.slug)
    };
  }

  const legacyTeacherResolution = resolveTeacherRouteBySlug(requested, slug);
  if (!legacyTeacherResolution?.teacher?.slug) return null;

  const fallback = getPracticePathBySlug(legacyTeacherResolution.teacher.slug);
  if (!fallback) return null;

  const canonicalLocale = getPracticePathCanonicalLocale(fallback);
  const canonicalPath = getPracticePathCanonicalPath(fallback);
  return {
    practicePath: fallback,
    canonicalLocale,
    canonicalPath,
    isCanonicalRequest: false
  };
}

export function getAlternatePracticePaths(currentPracticePath) {
  return (Array.isArray(practicePaths) ? practicePaths : []).filter((row) => row.slug !== currentPracticePath?.slug);
}
