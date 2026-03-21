import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { normalizeLanguageCode } from './shared/normalization.js';

export const IDIOM_TARGET_LANGUAGES = new Set(['en', 'de']);
export const IDIOM_LEVEL_FILE_TO_BUCKET = Object.freeze({
  a1: 'a1_a2',
  b1: 'b1_b2'
});

const IDIOM_LEVEL_COUNTS = Object.freeze({
  a1_a2: 2,
  b1_b2: 3
});

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'phrase_translation',
    'meaning_translation',
    'tone_translation',
    'example_translation'
  ],
  properties: {
    phrase_translation: { type: 'string' },
    meaning_translation: { type: 'string' },
    tone_translation: { type: 'string' },
    example_translation: { type: 'string' }
  }
};

function getClient(apiKey) {
  return new OpenAI({ apiKey });
}

function parseResponseOutput(response) {
  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      const text = (content?.text || '').toString().trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n').trim();
}

function normalizeTranslationText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function slugifyPhrase(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'phrase';
}

export function resolveIdiomPracticeLevelBucket(levelRaw) {
  const level = String(levelRaw ?? '').trim().toLowerCase();
  if (level === 'a1' || level === 'a2') return 'a1_a2';
  if (level === 'b1' || level === 'b2' || level === 'c1') return 'b1_b2';
  return 'a1_a2';
}

export function resolveIdiomPracticePhraseCount(levelRaw) {
  return IDIOM_LEVEL_COUNTS[resolveIdiomPracticeLevelBucket(levelRaw)] || 2;
}

export function buildIdiomPracticeScheduleKey(dateLike = new Date()) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function buildUtcDayRange(dateLike = new Date()) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return null;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, scheduleKey: buildIdiomPracticeScheduleKey(start) };
}

export function inferIdiomPhraseFileMeta(filePath) {
  const base = path.basename(filePath || '');
  const match = /^(?<target>[a-z]{2,8})_(?<level>a1|b1)\.json$/i.exec(base);
  if (!match?.groups) return null;

  const targetLanguage = normalizeLanguageCode(match.groups.target);
  const fileLevel = String(match.groups.level || '').toLowerCase();
  const levelBucket = IDIOM_LEVEL_FILE_TO_BUCKET[fileLevel] || '';
  if (!IDIOM_TARGET_LANGUAGES.has(targetLanguage) || !levelBucket) return null;

  return {
    fileName: base,
    fileStem: base.replace(/\.json$/i, ''),
    targetLanguage,
    fileLevel,
    levelBucket
  };
}

export function normalizeIdiomPhraseEntry(raw, { meta, index }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid phrase row at ${meta.fileName}#${index + 1}`);
  }

  const phraseText = String(raw.phrase ?? '').trim();
  const meaningText = String(raw.meaning ?? '').trim();
  const toneText = String(raw.tone ?? '').trim();
  const exampleText = String(raw.example ?? '').trim();
  if (!phraseText || !meaningText || !toneText || !exampleText) {
    throw new Error(`Missing phrase fields at ${meta.fileName}#${index + 1}`);
  }

  return {
    targetLanguage: meta.targetLanguage,
    levelBucket: meta.levelBucket,
    phraseText,
    meaningText,
    toneText,
    exampleText,
    sourceKey: `${meta.fileStem}:${slugifyPhrase(phraseText)}`
  };
}

export function loadIdiomPhraseFiles(dirPath) {
  const entries = [];
  const files = fs.readdirSync(dirPath).filter((file) => file.endsWith('.json')).sort();
  for (const fileName of files) {
    const absolutePath = path.join(dirPath, fileName);
    const meta = inferIdiomPhraseFileMeta(absolutePath);
    if (!meta) continue;
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array in ${fileName}`);
    }
    entries.push({
      meta,
      absolutePath,
      items: parsed.map((item, index) => normalizeIdiomPhraseEntry(item, { meta, index }))
    });
  }
  return entries;
}

export function collectIdiomPracticeBaseLanguages(configMap = {}) {
  const languages = new Set();
  for (const config of Object.values(configMap || {})) {
    const targetLanguage = normalizeLanguageCode(config?.learning_language || config?.target_lang || '');
    const baseLanguage = normalizeLanguageCode(config?.base_language || '');
    if (!IDIOM_TARGET_LANGUAGES.has(targetLanguage) || !baseLanguage) continue;
    languages.add(baseLanguage);
    languages.add(targetLanguage);
  }
  return [...languages].sort();
}

export async function translateIdiomPhraseEntry({
  apiKey,
  model,
  targetLanguage,
  baseLanguage,
  entry
}) {
  const normalizedTarget = normalizeLanguageCode(targetLanguage);
  const normalizedBase = normalizeLanguageCode(baseLanguage);
  if (!normalizedTarget || !normalizedBase) {
    throw new Error('Missing target/base language for idiom phrase translation');
  }

  if (normalizedTarget === normalizedBase) {
    return {
      phrase_translation: entry.phraseText,
      meaning_translation: entry.meaningText,
      tone_translation: entry.toneText,
      example_translation: entry.exampleText,
      source: 'passthrough'
    };
  }

  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const client = getClient(apiKey);
  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: [
          'Translate a language-learning phrase card into the base language.',
          'Keep the target-language phrase unchanged in intent, but provide a natural user-facing translation.',
          'Translate meaning, tone, and example into the base language.',
          'Return only JSON matching the schema.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          target_language_code: normalizedTarget,
          base_language_code: normalizedBase,
          phrase: entry.phraseText,
          meaning: entry.meaningText,
          tone: entry.toneText,
          example: entry.exampleText
        })
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'idiom_phrase_translation',
        schema: TRANSLATION_SCHEMA,
        verbosity: 'low'
      }
    }
  });

  const rawText = parseResponseOutput(response);
  if (!rawText) throw new Error('OpenAI idiom phrase translation returned no text output');
  const parsed = JSON.parse(rawText);
  return {
    phrase_translation: normalizeTranslationText(parsed?.phrase_translation, entry.phraseText),
    meaning_translation: normalizeTranslationText(parsed?.meaning_translation, entry.meaningText),
    tone_translation: normalizeTranslationText(parsed?.tone_translation, entry.toneText),
    example_translation: normalizeTranslationText(parsed?.example_translation, entry.exampleText),
    source: 'llm'
  };
}
