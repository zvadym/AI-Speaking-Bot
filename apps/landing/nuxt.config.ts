import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SITE_URL = 'https://ai-language-school.online';
const SUPPORTED_LOCALES = ['en', 'uk', 'it'];

function normalizeSlug(input: unknown) {
  return String(input ?? '').trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function loadTeacherSlugs() {
  try {
    const mod = await import(pathToFileURL(resolve(process.cwd(), 'src/generated/teachers.js')).href);
    const rows = Array.isArray(mod?.teachers) ? mod.teachers : [];
    return unique(rows.map((row: Record<string, unknown>) => normalizeSlug(row?.slug)));
  } catch {
    return [];
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

const [teacherSlugs, blogSlugs] = await Promise.all([loadTeacherSlugs(), loadBlogSlugs()]);

const localizedBaseRoutes = SUPPORTED_LOCALES.flatMap((locale) => [
  `/${locale}`,
  `/${locale}/teachers`,
  ...teacherSlugs.map((slug) => `/${locale}/teachers/${encodeURIComponent(slug)}`),
  ...blogSlugs.map((slug) => `/${locale}/blog/${encodeURIComponent(slug)}`)
]);

const redirectRoutes = [
  '/',
  '/teachers',
  ...teacherSlugs.map((slug) => `/teachers/${encodeURIComponent(slug)}`),
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
      link: [{ rel: 'icon', href: '/favicon.svg' }]
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
      routes: unique([...localizedBaseRoutes, ...redirectRoutes])
    }
  }
});
