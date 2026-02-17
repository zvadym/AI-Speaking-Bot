import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SUPPORTED_LOCALES,
  getLanguageSlugToken,
  normalizeLanguageCodeForSlugs
} from '../src/data/slugTokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const botsDir = path.resolve(repoRoot, 'deploy/bots');
const outputDir = path.resolve(repoRoot, 'apps/landing/src/generated');
const outputFile = path.resolve(outputDir, 'teachers.js');
const sitemapFile = path.resolve(repoRoot, 'apps/landing/public/sitemap.xml');
const teacherAvatarsDir = path.resolve(repoRoot, 'apps/landing/public/teachers');
const teacherAvatarsThumbnailDir = path.resolve(teacherAvatarsDir, 'thumbnail');

const SITE_ORIGIN = 'https://ai-language-school.online';
const AVATAR_EXTS = ['avif', 'webp', 'png', 'jpg', 'jpeg', 'svg'];

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeLanguageCode(input) {
  return normalizeLanguageCodeForSlugs(input);
}

function normalizeCanonicalLocale(input) {
  const normalized = normalizeLanguageCode(input) || '';
  if (SUPPORTED_LOCALES.includes(normalized)) return normalized;
  return 'en';
}

function slugifyAscii(input) {
  return safeString(input)
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractEnglishName(config) {
  const prompt = safeString(config?.locale?.model_system_prompt);
  if (!prompt.toLowerCase().startsWith('you are ')) return '';

  const rest = prompt.slice('You are '.length);
  const stopIdxCandidates = [
    rest.indexOf(','),
    rest.indexOf('('),
    rest.indexOf('\n')
  ].filter((n) => n >= 0);
  const stopIdx = stopIdxCandidates.length ? Math.min(...stopIdxCandidates) : rest.length;
  return safeString(rest.slice(0, stopIdx));
}

function detectAvatarAssets(botKey) {
  const key = safeString(botKey);
  if (!key) return { avatarImage: '', avatarSources: {} };

  const avatarSources = {};
  for (const ext of ['avif', 'webp', 'png']) {
    const thumbPath = path.resolve(teacherAvatarsThumbnailDir, `${key}.${ext}`);
    if (fs.existsSync(thumbPath)) avatarSources[ext] = `/teachers/thumbnail/${key}.${ext}`;
  }

  if (!avatarSources.png && !avatarSources.webp && !avatarSources.avif) {
    for (const ext of AVATAR_EXTS) {
      const filename = `${key}.${ext}`;
      const fullPath = path.resolve(teacherAvatarsDir, filename);
      if (fs.existsSync(fullPath) && !avatarSources[ext]) avatarSources[ext] = `/teachers/${filename}`;
    }
  }

  const avatarImage = avatarSources.png || avatarSources.webp || avatarSources.avif || '';
  return { avatarImage, avatarSources };
}

function buildPublicSlugs(teacherSlugBase, learningLanguage) {
  const normalizedLearningLanguage = normalizeLanguageCode(learningLanguage) || 'en';
  const result = {};
  for (const locale of SUPPORTED_LOCALES) {
    const languageToken = getLanguageSlugToken(locale, normalizedLearningLanguage) || normalizedLearningLanguage;
    result[locale] = `${teacherSlugBase}-${languageToken}-teacher`;
  }
  return result;
}

function finalizeTeacherSlugs(teachers) {
  const seenBases = new Set();
  return teachers.map((teacher) => {
    const preferredBase = slugifyAscii(teacher.displayName?.en) || slugifyAscii(teacher.teacherKey) || 'teacher';
    let teacherSlugBase = preferredBase;

    if (seenBases.has(teacherSlugBase)) {
      const fallbackSuffix = slugifyAscii(teacher.teacherKey) || 'teacher';
      teacherSlugBase = `${preferredBase}-${fallbackSuffix}`;
      let idx = 2;
      while (seenBases.has(teacherSlugBase)) {
        teacherSlugBase = `${preferredBase}-${fallbackSuffix}-${idx}`;
        idx += 1;
      }
    }

    seenBases.add(teacherSlugBase);
    const publicSlugs = buildPublicSlugs(teacherSlugBase, teacher.learningLanguage);
    const canonicalLocale = normalizeCanonicalLocale(teacher.baseLanguage);
    const canonicalSlug = safeString(publicSlugs[canonicalLocale] || publicSlugs.en || teacher.legacyPairSlug);
    const canonicalPath = canonicalSlug
      ? `/${canonicalLocale}/teachers/${encodeURIComponent(canonicalSlug)}`
      : `/${canonicalLocale}/teachers`;

    return {
      ...teacher,
      teacherSlugBase,
      publicSlugs,
      canonicalLocale,
      canonicalSlug,
      canonicalPath
    };
  });
}

function buildTeacher(config, filename) {
  const botKey = safeString(config.bot_key) || safeString(config.bot_key ?? '') || filename;
  const teacherKey = botKey || filename;
  const legacyPairSlug = teacherKey;

  const baseLanguage = normalizeLanguageCode(config.base_language) || 'en';
  const learningLanguage = normalizeLanguageCode(config.learning_language) || 'en';

  const nameUk = safeString(config.bot_name);
  const nameEn = extractEnglishName(config);
  const nameFallback = nameEn || nameUk || teacherKey;

  const baseTagline = safeString(config.teacher_tagline_uk);
  const taglines = {
    uk: baseTagline,
    en: safeString(config.teacher_tagline_en),
    it: safeString(config.teacher_tagline_it)
  };
  if (baseLanguage) taglines[baseLanguage] = baseTagline || taglines[baseLanguage] || '';
  if (!taglines.it) taglines.it = taglines.en || taglines.uk;

  const { avatarImage, avatarSources } = detectAvatarAssets(botKey);

  return {
    slug: legacyPairSlug,
    teacherKey,
    legacyPairSlug,
    teacherSlugBase: '',
    publicSlugs: {},
    botKey,
    baseLanguage,
    learningLanguage,
    avatarEmoji: safeString(config.teacher_avatar_emoji),
    avatarImage,
    avatarSources,
    displayName: {
      uk: nameUk || nameFallback,
      en: nameEn || nameFallback,
      it: nameEn || nameFallback
    },
    taglines,
    styleTags: Array.isArray(config.teacher_style_tags) ? config.teacher_style_tags.slice(0, 12) : [],
    telegramUrl: safeString(config.telegram_url)
  };
}

function readBots() {
  if (!fs.existsSync(botsDir)) return [];
  const entries = fs.readdirSync(botsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  const teachers = [];
  for (const file of files) {
    const fullPath = path.resolve(botsDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    let config;
    try {
      config = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse ${fullPath}: ${err?.message || err}`);
    }

    teachers.push(buildTeacher(config, file.replace(/\.json$/i, '')));
  }

  return teachers;
}

function assertNoSecrets(teacher) {
  const serialized = JSON.stringify(teacher);
  const secretHints = ['telegram_bot_token', 'telegram_credential_id', 'model_system_prompt', 'model_support_prompt'];
  for (const hint of secretHints) {
    if (serialized.includes(hint)) throw new Error(`Generated output unexpectedly contains "${hint}"`);
  }
}

function writeTeachersModule(teachers) {
  for (const teacher of teachers) assertNoSecrets(teacher);

  fs.mkdirSync(outputDir, { recursive: true });

  const payload = JSON.stringify(teachers, null, 2);
  const code = `// THIS FILE IS AUTO-GENERATED by apps/landing/scripts/generate-teachers.mjs\n// Do not edit by hand.\n\nexport const teachers = ${payload};\n\nexport function getTeacherByKey(keyInput) {\n  const key = (keyInput || '').toString().trim().toLowerCase();\n  return teachers.find((t) => (t.teacherKey || '').toString().toLowerCase() === key) || null;\n}\n\nexport function getTeacherByLegacyPairSlug(slugInput) {\n  const slug = (slugInput || '').toString().trim().toLowerCase();\n  return teachers.find((t) => (t.legacyPairSlug || '').toString().toLowerCase() === slug) || null;\n}\n\nexport function getTeacherBySlug(slugInput) {\n  return getTeacherByLegacyPairSlug(slugInput);\n}\n\nexport function getTeacherName(teacher, locale) {\n  const l = (locale || '').toString();\n  if (!teacher) return '';\n  const map = teacher.displayName || {};\n  return (map[l] || map.en || map.uk || teacher.teacherKey || '').toString();\n}\n\nexport function getTeacherTagline(teacher, locale) {\n  const l = (locale || '').toString();\n  if (!teacher) return '';\n  const map = teacher.taglines || {};\n  return (map[l] || map.en || map.uk || '').toString();\n}\n`;

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

function writeSitemap(teachers, blogPosts) {
  const blogPaths = (Array.isArray(blogPosts) ? blogPosts : [])
    .map((post) => safeString(post?.slug))
    .filter(Boolean)
    .map((slug) => `/blog/${encodeURIComponent(slug)}`);

  const localePages = SUPPORTED_LOCALES.flatMap((locale) => {
    const localizedPaths = [
      '',
      '/teachers',
      ...blogPaths
    ];
    return localizedPaths.map((pathSuffix) => `${SITE_ORIGIN}/${locale}${pathSuffix}`);
  });

  const teacherCanonicalPages = teachers
    .map((teacher) => safeString(teacher?.canonicalPath))
    .filter(Boolean)
    .map((pathname) => `${SITE_ORIGIN}${pathname}`);

  const urls = [...localePages, ...teacherCanonicalPages];

  const uniqueUrls = Array.from(new Set(urls));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueUrls
    .map((u) => `  <url>\n    <loc>${xmlEscape(u)}</loc>\n  </url>`)
    .join('\n')}\n</urlset>\n`;

  fs.writeFileSync(sitemapFile, xml, 'utf8');
}

async function readBlogPosts() {
  try {
    const moduleUrl = pathToFileURL(path.resolve(repoRoot, 'apps/landing/src/data/blogPosts.js')).href;
    const mod = await import(moduleUrl);
    const posts = Array.isArray(mod.blogPosts) ? mod.blogPosts : [];
    return posts.filter((p) => safeString(p?.slug));
  } catch {
    return [];
  }
}

const blogPosts = await readBlogPosts();

const teachers = finalizeTeacherSlugs(readBots()
  .filter((t) => safeString(t.teacherKey))
  .filter((t) => safeString(t.telegramUrl))
  .sort((a, b) => a.teacherKey.localeCompare(b.teacherKey)));

if (!teachers.length) {
  console.log('No bot configs found; leaving generated teachers as-is.');
  process.exit(0);
}

writeTeachersModule(teachers);
writeSitemap(teachers, blogPosts);

console.log(`Generated ${teachers.length} teacher(s) -> ${path.relative(repoRoot, outputFile)}`);
