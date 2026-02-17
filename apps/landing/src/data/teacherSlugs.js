import { teachers } from '../generated/teachers.js';
import { normalizeLocale } from '../i18n.js';

function normalizeSlug(input) {
  return (input || '').toString().trim().toLowerCase();
}

export function getTeacherCanonicalLocale(teacher) {
  return normalizeLocale(teacher?.canonicalLocale || teacher?.baseLanguage) || 'en';
}

export function getTeacherCanonicalSlug(teacher) {
  if (!teacher) return '';
  const direct = (teacher?.canonicalSlug || '').toString().trim();
  if (direct) return direct;

  const canonicalLocale = getTeacherCanonicalLocale(teacher);
  const map = teacher?.publicSlugs || {};
  return (map[canonicalLocale] || map.en || teacher?.legacyPairSlug || teacher?.slug || '').toString().trim();
}

export function getTeacherCanonicalPathSuffix(teacher) {
  const slug = getTeacherCanonicalSlug(teacher);
  if (!slug) return '/teachers';
  return `/teachers/${encodeURIComponent(slug)}`;
}

export function getTeacherCanonicalPath(teacher) {
  const canonicalLocale = getTeacherCanonicalLocale(teacher);
  const suffix = getTeacherCanonicalPathSuffix(teacher);
  return `/${canonicalLocale}${suffix}`;
}

export function getTeacherPublicSlug(teacher, locale = 'en') {
  const loc = normalizeLocale(locale) || 'en';
  const map = teacher?.publicSlugs || {};
  const slug = (map[loc] || map.en || '').toString().trim();
  return slug;
}

export function getTeacherPathSuffix(teacher, locale = 'en') {
  const slug = getTeacherPublicSlug(teacher, locale);
  if (!slug) return '/teachers';
  return `/teachers/${encodeURIComponent(slug)}`;
}

function getTeacherAliasSlugSet(teacher) {
  const slugs = new Set();

  const canonicalSlug = normalizeSlug(getTeacherCanonicalSlug(teacher));
  if (canonicalSlug) slugs.add(canonicalSlug);

  const legacyPairSlug = normalizeSlug(teacher?.legacyPairSlug || teacher?.slug);
  if (legacyPairSlug) slugs.add(legacyPairSlug);

  const map = teacher?.publicSlugs || {};
  for (const value of Object.values(map)) {
    const normalized = normalizeSlug(value);
    if (normalized) slugs.add(normalized);
  }

  return slugs;
}

export function resolveTeacherRouteBySlug(localeInput, slugInput) {
  const requestedLocale = normalizeLocale(localeInput);
  const requestedSlug = normalizeSlug(slugInput);
  if (!requestedSlug) return null;

  let best = null;

  for (const teacher of teachers) {
    const aliasSlugs = getTeacherAliasSlugSet(teacher);
    if (!aliasSlugs.has(requestedSlug)) continue;

    const canonicalLocale = getTeacherCanonicalLocale(teacher);
    const canonicalSlug = normalizeSlug(getTeacherCanonicalSlug(teacher));
    const localizedSlug = requestedLocale ? normalizeSlug(teacher?.publicSlugs?.[requestedLocale]) : '';

    let score = 1;
    if (requestedSlug === canonicalSlug) score = 2;
    if (requestedLocale && requestedSlug === localizedSlug) score = 3;

    if (!best || score > best.score) {
      best = {
        teacher,
        score,
        canonicalLocale,
        canonicalSlug
      };
    }
  }

  if (!best) return null;

  const canonicalPath = getTeacherCanonicalPath(best.teacher);
  const isCanonicalRequest =
    !!requestedLocale &&
    requestedLocale === best.canonicalLocale &&
    requestedSlug === best.canonicalSlug;

  return {
    teacher: best.teacher,
    canonicalLocale: best.canonicalLocale,
    canonicalSlug: best.canonicalSlug,
    canonicalPath,
    requestedLocale: requestedLocale || '',
    requestedSlug,
    isCanonicalRequest
  };
}

export function findTeacherByPublicSlug(locale, slugInput) {
  const loc = normalizeLocale(locale) || 'en';
  const slug = normalizeSlug(slugInput);
  if (!slug) return null;
  return teachers.find((teacher) => normalizeSlug(teacher?.publicSlugs?.[loc]) === slug) || null;
}

export function findTeacherByLegacyPairSlug(slugInput) {
  const slug = normalizeSlug(slugInput);
  if (!slug) return null;
  return teachers.find((teacher) => normalizeSlug(teacher?.legacyPairSlug || teacher?.slug) === slug) || null;
}

export function isLegacyPairSlug(slugInput) {
  return !!findTeacherByLegacyPairSlug(slugInput);
}

export function getAlternateTeacherPaths(teacher) {
  if (!teacher) return {};
  const locale = getTeacherCanonicalLocale(teacher);
  return {
    [locale]: getTeacherCanonicalPathSuffix(teacher)
  };
}

export function listTeacherSlugsForLocale(locale) {
  const loc = normalizeLocale(locale) || 'en';
  return teachers
    .map((teacher) => getTeacherPublicSlug(teacher, loc))
    .filter(Boolean);
}
