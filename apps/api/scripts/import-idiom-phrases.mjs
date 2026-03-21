#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { loadBotConfigs } from '../src/bot-configs.js';
import {
  buildIdiomPhraseSourceSignature,
  collectIdiomPracticeBaseLanguages,
  loadIdiomPhraseFiles,
  translateIdiomPhraseEntry
} from '../src/idiom-phrases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const PHRASES_DIR = (process.env.IDIOM_PHRASES_DIR || '').toString().trim()
  || path.join(ROOT_DIR, 'deploy/phrases');
const databaseUrl = (process.env.DATABASE_URL || '').toString().trim();

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const ssl = (process.env.DATABASE_SSL || '').toString().trim().toLowerCase() === 'true'
  ? { rejectUnauthorized: (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toString().trim().toLowerCase() !== 'false' }
  : undefined;

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl
});

const args = new Set(process.argv.slice(2));
const shouldTranslate = !args.has('--skip-translate');
const translationModel = (process.env.IDIOM_PRACTICE_OPENAI_MODEL || process.env.TOPIC_GENERATION_MODEL || 'gpt-5.4')
  .toString()
  .trim() || 'gpt-5.4';
const translationConcurrency = Math.max(1, Math.min(8, Number(process.env.IDIOM_PRACTICE_TRANSLATION_CONCURRENCY || 4) || 4));

async function upsertCatalogEntry(client, entry) {
  const { rows } = await client.query(
    `INSERT INTO idiom_phrase_catalog (
       target_language,
       level_bucket,
       phrase_text,
       meaning_text,
       tone_text,
       example_text,
       source_key,
       is_active,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
     ON CONFLICT (source_key) DO UPDATE
       SET target_language = EXCLUDED.target_language,
           level_bucket = EXCLUDED.level_bucket,
           phrase_text = EXCLUDED.phrase_text,
           meaning_text = EXCLUDED.meaning_text,
           tone_text = EXCLUDED.tone_text,
           example_text = EXCLUDED.example_text,
           is_active = true,
           updated_at = NOW()
     RETURNING id`,
    [
      entry.targetLanguage,
      entry.levelBucket,
      entry.phraseText,
      entry.meaningText,
      entry.toneText,
      entry.exampleText,
      entry.sourceKey
    ]
  );
  return Number(rows[0]?.id || 0);
}

async function deactivateMissingEntries(client, fileStem, activeSourceKeys) {
  await client.query(
    `UPDATE idiom_phrase_catalog
        SET is_active = false,
            updated_at = NOW()
      WHERE source_key LIKE $1
        AND NOT (source_key = ANY($2::text[]))`,
    [`${fileStem}:%`, activeSourceKeys]
  );
}

async function upsertTranslation(client, phraseId, baseLanguage, translation) {
  await client.query(
    `INSERT INTO idiom_phrase_translations (
       phrase_id,
       base_language,
       phrase_translation,
       meaning_translation,
       tone_translation,
       example_translation,
       source,
       source_signature,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (phrase_id, base_language) DO UPDATE
       SET phrase_translation = EXCLUDED.phrase_translation,
           meaning_translation = EXCLUDED.meaning_translation,
           tone_translation = EXCLUDED.tone_translation,
           example_translation = EXCLUDED.example_translation,
           source = EXCLUDED.source,
           source_signature = EXCLUDED.source_signature,
           updated_at = NOW()`,
    [
      phraseId,
      baseLanguage,
      translation.phrase_translation,
      translation.meaning_translation,
      translation.tone_translation,
      translation.example_translation,
      translation.source,
      translation.source_signature
    ]
  );
}

async function loadExistingTranslationSignatures(client, phraseIds) {
  const normalizedIds = phraseIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (!normalizedIds.length) return new Map();

  const { rows } = await client.query(
    `SELECT phrase_id, base_language, source_signature
       FROM idiom_phrase_translations
      WHERE phrase_id = ANY($1::bigint[])`,
    [normalizedIds]
  );

  const map = new Map();
  for (const row of rows || []) {
    map.set(`${Number(row.phrase_id)}:${String(row.base_language || '').trim()}`, String(row.source_signature || '').trim());
  }
  return map;
}

async function runWithConcurrency(items, concurrency, worker) {
  const pending = [...items];
  const runners = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (pending.length) {
      const next = pending.shift();
      await worker(next);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!fs.existsSync(PHRASES_DIR)) {
    throw new Error(`Missing phrases directory: ${PHRASES_DIR}`);
  }

  const filePayloads = loadIdiomPhraseFiles(PHRASES_DIR);
  if (!filePayloads.length) {
    throw new Error(`No idiom phrase files found in ${PHRASES_DIR}`);
  }

  const configMap = loadBotConfigs();
  const baseLanguages = collectIdiomPracticeBaseLanguages(configMap);
  const apiKey = (process.env.OPENAI_API_KEY || '').toString().trim();
  if (shouldTranslate && !apiKey) {
    throw new Error('Missing OPENAI_API_KEY for translation generation. Re-run with --skip-translate to import only.');
  }

  const client = await pool.connect();
  try {
    console.log(`Importing idiom phrase catalog from ${PHRASES_DIR}`);
    await client.query('BEGIN');

    const imported = [];
    for (const payload of filePayloads) {
      const activeSourceKeys = [];
      for (const entry of payload.items) {
        const phraseId = await upsertCatalogEntry(client, entry);
        imported.push({ phraseId, entry, sourceSignature: buildIdiomPhraseSourceSignature(entry) });
        activeSourceKeys.push(entry.sourceKey);
      }
      await deactivateMissingEntries(client, payload.meta.fileStem, activeSourceKeys);
      console.log(`Imported ${payload.items.length} rows from ${payload.meta.fileName}`);
    }
    await client.query('COMMIT');

    if (shouldTranslate) {
      const existingSignatures = await loadExistingTranslationSignatures(client, imported.map((item) => item.phraseId));
      const translationJobs = [];
      for (const item of imported) {
        for (const baseLanguage of baseLanguages) {
          const key = `${item.phraseId}:${baseLanguage}`;
          if (existingSignatures.get(key) === item.sourceSignature) continue;
          translationJobs.push({ ...item, baseLanguage });
        }
      }

      console.log(`Need ${translationJobs.length} translation upserts across ${baseLanguages.length} base languages`);
      let completed = 0;
      await runWithConcurrency(translationJobs, translationConcurrency, async (job) => {
        const translation = await translateIdiomPhraseEntry({
          apiKey,
          model: translationModel,
          targetLanguage: job.entry.targetLanguage,
          baseLanguage: job.baseLanguage,
          entry: job.entry
        });
        await upsertTranslation(pool, job.phraseId, job.baseLanguage, {
          ...translation,
          source_signature: job.sourceSignature
        });
        completed += 1;
        if (completed % 25 === 0 || completed === translationJobs.length) {
          console.log(`Translated ${completed}/${translationJobs.length}`);
        }
      });
    }
    console.log(`Imported ${imported.length} idiom phrases from ${PHRASES_DIR}`);
    if (shouldTranslate) {
      console.log(`Ensured translations for base languages: ${baseLanguages.join(', ')}`);
    } else {
      console.log('Skipped translation generation');
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error?.message || error);
    await pool.end();
    process.exit(1);
  });
