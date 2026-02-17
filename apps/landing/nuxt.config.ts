import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SITE_URL = 'https://ai-language-school.online';
const SUPPORTED_LOCALES = ['en', 'de', 'es', 'pt', 'uk', 'it'];

function normalizeSlug(input: unknown) {
  return String(input ?? '').trim();
}

function normalizeLocaleCode(input: unknown) {
  const raw = String(input ?? '').trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(raw) ? raw : 'en';
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function loadTeachers() {
  try {
    const mod = await import(pathToFileURL(resolve(process.cwd(), 'src/generated/teachers.js')).href);
    const rows = Array.isArray(mod?.teachers) ? mod.teachers : [];
    return rows as Record<string, unknown>[];
  } catch {
    return [] as Record<string, unknown>[];
  }
}

async function loadBlogSlugs() {
  try {
    const mod = await import(pathToFileURL(resolve(process.cwd(), 'src/data/blogPosts.js')).href);
    const rows = Array.isArray(mod?.blogPosts) ? mod.blogPosts : [];
    return unique(rows.map((row: Record<string, unknown>) => normalizeSlug(row?.slug)));
  } catch {
    return [];
  }
}

function buildTeacherRouteSets(teachers: Record<string, unknown>[]) {
  const canonicalRoutes: string[] = [];
  const localizedAliasRoutes: string[] = [];
  const bareAliasRoutes: string[] = [];

  for (const row of teachers) {
    const publicSlugs = (row?.publicSlugs as Record<string, unknown>) || {};
    const canonicalLocale = normalizeLocaleCode(row?.canonicalLocale);
    const canonicalSlug = normalizeSlug(row?.canonicalSlug || publicSlugs[canonicalLocale] || publicSlugs.en);
    const canonicalRoute = canonicalSlug
      ? `/${canonicalLocale}/teachers/${encodeURIComponent(canonicalSlug)}`
      : `/${canonicalLocale}/teachers`;

    if (canonicalSlug) canonicalRoutes.push(canonicalRoute);

    const slugAliases = unique([
      canonicalSlug,
      normalizeSlug(row?.legacyPairSlug),
      normalizeSlug(row?.slug),
      ...Object.values(publicSlugs).map((value) => normalizeSlug(value))
    ]);

    for (const slug of slugAliases) {
      bareAliasRoutes.push(`/teachers/${encodeURIComponent(slug)}`);

      for (const locale of SUPPORTED_LOCALES) {
        const localizedRoute = `/${locale}/teachers/${encodeURIComponent(slug)}`;
        if (localizedRoute !== canonicalRoute) localizedAliasRoutes.push(localizedRoute);
      }
    }
  }

  return {
    canonicalRoutes: unique(canonicalRoutes),
    localizedAliasRoutes: unique(localizedAliasRoutes),
    bareAliasRoutes: unique(bareAliasRoutes)
  };
}

const [teachers, blogSlugs] = await Promise.all([loadTeachers(), loadBlogSlugs()]);
const teacherRoutes = buildTeacherRouteSets(teachers);

const localizedBaseRoutes = SUPPORTED_LOCALES.flatMap((locale) => [
  `/${locale}`,
  `/${locale}/teachers`,
  ...blogSlugs.map((slug) => `/${locale}/blog/${encodeURIComponent(slug)}`)
]);

const redirectRoutes = [
  '/',
  '/teachers',
  ...teacherRoutes.bareAliasRoutes,
  ...blogSlugs.map((slug) => `/blog/${encodeURIComponent(slug)}`)
];

export default defineNuxtConfig({
  ssr: true,
  srcDir: 'src/',
  dir: {
    pages: 'routes',
    public: '../public'
  },
  css: ['~/style.css'],
  app: {
    head: {
      meta: [{ name: 'theme-color', content: '#ffffff' }],
      link: [{ rel: 'icon', href: '/favicon.svg' }],
      script: [
        {
          src: 'https://analytics.ahrefs.com/analytics.js',
          'data-key': 'pHeSsDVGTy5kHTPBLrCJNQ',
          async: true
        }
      ]
    }
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || process.env.VITE_SITE_URL || DEFAULT_SITE_URL,
      contactWebhookUrl: process.env.NUXT_PUBLIC_CONTACT_WEBHOOK_URL || process.env.VITE_CONTACT_WEBHOOK_URL || ''
    }
  },
  nitro: {
    prerender: {
      crawlLinks: false,
      routes: unique([
        ...localizedBaseRoutes,
        ...teacherRoutes.canonicalRoutes,
        ...teacherRoutes.localizedAliasRoutes,
        ...redirectRoutes
      ])
    }
  }
});
