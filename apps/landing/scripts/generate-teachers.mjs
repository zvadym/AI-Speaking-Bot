import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blogPosts } from '../src/data/blogPosts.js';
import { SUPPORTED_LOCALES } from '../src/data/slugTokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const botsDir = path.resolve(repoRoot, 'deploy/bots');
const outputDir = path.resolve(repoRoot, 'apps/landing/src/generated');
const outputFile = path.resolve(outputDir, 'practicePaths.js');
const sitemapFile = path.resolve(repoRoot, 'apps/landing/public/sitemap.xml');
const legacyTeachersFile = path.resolve(outputDir, 'teachers.js');

const DEFAULT_SITE_ORIGIN = 'https://ai-language-school.online';
const ROMI_AVATAR = '/avatar/base.png';

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getSiteOrigin() {
  const candidates = [
    process.env.NUXT_PUBLIC_SITE_URL,
    process.env.VITE_SITE_URL,
    process.env.SITE_URL,
    DEFAULT_SITE_ORIGIN
  ];

  for (const candidate of candidates) {
    const raw = safeString(candidate);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!/^https?:$/i.test(url.protocol)) continue;
      return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
    } catch {
      // ignore malformed values
    }
  }

  return DEFAULT_SITE_ORIGIN;
}

function normalizeLanguageCode(input) {
  const raw = safeString(input).toLowerCase();
  if (raw === 'ua' || raw === 'uk-ua' || raw === 'ua-ua') return 'uk';
  if (!raw) return '';
  return raw.split('-')[0];
}

function normalizeCanonicalLocale(input) {
  const normalized = normalizeLanguageCode(input);
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : 'en';
}

function readBots() {
  if (!fs.existsSync(botsDir)) return [];
  const entries = fs.readdirSync(botsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .map((file) => {
      const fullPath = path.resolve(botsDir, file);
      const raw = fs.readFileSync(fullPath, 'utf8');
      let config;
      try {
        config = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Failed to parse ${fullPath}: ${error?.message || error}`);
      }
      return { file, config };
    });
}

async function loadLegacyTeacherMap() {
  if (!fs.existsSync(legacyTeachersFile)) return new Map();
  try {
    const legacyModule = await import(pathToFileURL(legacyTeachersFile).href);
    const rows = Array.isArray(legacyModule?.teachers) ? legacyModule.teachers : [];
    return new Map(rows.map((row) => [safeString(row?.slug || row?.legacyPairSlug).toLowerCase(), row]));
  } catch {
    return new Map();
  }
}

function getLegacyAliases(config, slug, legacyTeacher) {
  const aliases = new Set([slug]);
  const legacySources = [
    config?.bot_name,
    config?.teacher_slug,
    config?.teacher_name,
    config?.teacher_name_en,
    config?.teacher_name_uk,
    legacyTeacher?.legacyPairSlug,
    legacyTeacher?.canonicalSlug,
    legacyTeacher?.teacherSlugBase
  ];

  const publicSlugs = legacyTeacher?.publicSlugs && typeof legacyTeacher.publicSlugs === 'object'
    ? Object.values(legacyTeacher.publicSlugs)
    : [];
  for (const value of publicSlugs) legacySources.push(value);

  for (const value of legacySources) {
    const raw = safeString(value)
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (raw) aliases.add(raw);
  }

  return Array.from(aliases);
}

function buildPracticePath(config, filename, legacyTeacher) {
  const botKey = safeString(config.bot_key) || filename;
  const slug = botKey.toLowerCase();
  const baseLanguage = normalizeLanguageCode(config.base_language) || normalizeLanguageCode(slug.split('-')[0]) || 'en';
  const targetLanguage = normalizeLanguageCode(config.learning_language) || normalizeLanguageCode(slug.split('-')[1]) || 'en';
  const canonicalLocale = normalizeCanonicalLocale(baseLanguage);

  return {
    slug,
    botKey,
    legacyAliases: getLegacyAliases(config, slug, legacyTeacher),
    baseLanguage,
    targetLanguage,
    title: `${baseLanguage.toUpperCase()} → ${targetLanguage.toUpperCase()}`,
    description: 'Practice real conversations with Romi',
    tags: [],
    telegramUrl: safeString(config.telegram_url),
    avatarImage: ROMI_AVATAR,
    avatarSources: { png: ROMI_AVATAR },
    canonicalLocale,
    canonicalPath: `/${canonicalLocale}/practice/${encodeURIComponent(slug)}`
  };
}

function assertNoSecrets(row) {
  const serialized = JSON.stringify(row);
  const secretHints = ['telegram_bot_token', 'telegram_credential_id', 'model_system_prompt', 'model_support_prompt'];
  for (const hint of secretHints) {
    if (serialized.includes(hint)) throw new Error(`Generated output unexpectedly contains "${hint}"`);
  }
}

function writePracticePathsModule(practicePaths) {
  for (const row of practicePaths) assertNoSecrets(row);

  fs.mkdirSync(outputDir, { recursive: true });
  const payload = JSON.stringify(practicePaths, null, 2);
  const code = `// THIS FILE IS AUTO-GENERATED by apps/landing/scripts/generate-teachers.mjs\n// Do not edit by hand.\n\nexport const practicePaths = ${payload};\n\nexport function getPracticePathBySlug(slugInput) {\n  const slug = (slugInput || '').toString().trim().toLowerCase();\n  return practicePaths.find((row) => (row.slug || '').toString().toLowerCase() === slug) || null;\n}\n\nexport function getPracticePathByLegacyAlias(slugInput) {\n  const slug = (slugInput || '').toString().trim().toLowerCase();\n  return practicePaths.find((row) => Array.isArray(row.legacyAliases) && row.legacyAliases.some((alias) => (alias || '').toString().toLowerCase() === slug)) || null;\n}\n`;
  fs.writeFileSync(outputFile, code, 'utf8');
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function writeSitemap(practicePaths) {
  const siteOrigin = getSiteOrigin();
  const localePages = SUPPORTED_LOCALES.flatMap((locale) => [
    `/${locale}`,
    `/${locale}/practice`
  ]);
  const practicePages = practicePaths.map((row) => row.canonicalPath).filter(Boolean);
  const blogPages = blogPosts.map((post) => `/blog/${encodeURIComponent(post.slug)}`);
  const uniquePaths = Array.from(new Set([...localePages, ...practicePages, ...blogPages]));

  const body = uniquePaths
    .map((pathname) => `  <url><loc>${xmlEscape(`${siteOrigin}${pathname}`)}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(sitemapFile, xml, 'utf8');
}

const legacyTeacherMap = await loadLegacyTeacherMap();
const practicePaths = readBots().map(({ file, config }) => {
  const slug = file.replace(/\.json$/i, '').toLowerCase();
  return buildPracticePath(config, slug, legacyTeacherMap.get(slug) || null);
});
writePracticePathsModule(practicePaths);
writeSitemap(practicePaths);
