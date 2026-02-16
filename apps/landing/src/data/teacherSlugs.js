import { teachers } from '../generated/teachers.js';
import { normalizeLocale, supportedLocales } from '../i18n.js';

function normalizeSlug(input) {
  return (input || '').toString().trim().toLowerCase();
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
  const paths = {};
  for (const locale of supportedLocales) {
    const loc = normalizeLocale(locale) || 'en';
    const slug = getTeacherPublicSlug(teacher, loc);
    if (!slug) continue;
    paths[loc] = `/teachers/${encodeURIComponent(slug)}`;
  }
  return paths;
}

export function listTeacherSlugsForLocale(locale) {
  const loc = normalizeLocale(locale) || 'en';
  return teachers
    .map((teacher) => getTeacherPublicSlug(teacher, loc))
    .filter(Boolean);
}
