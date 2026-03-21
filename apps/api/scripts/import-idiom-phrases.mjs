#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { loadBotConfigs } from '../src/bot-configs.js';
import {
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
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (phrase_id, base_language) DO UPDATE
       SET phrase_translation = EXCLUDED.phrase_translation,
           meaning_translation = EXCLUDED.meaning_translation,
           tone_translation = EXCLUDED.tone_translation,
           example_translation = EXCLUDED.example_translation,
           source = EXCLUDED.source,
           updated_at = NOW()`,
    [
      phraseId,
      baseLanguage,
      translation.phrase_translation,
      translation.meaning_translation,
      translation.tone_translation,
      translation.example_translation,
      translation.source
    ]
  );
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
    await client.query('BEGIN');

    const imported = [];
    for (const payload of filePayloads) {
      const activeSourceKeys = [];
      for (const entry of payload.items) {
        const phraseId = await upsertCatalogEntry(client, entry);
        imported.push({ phraseId, entry });
        activeSourceKeys.push(entry.sourceKey);
      }
      await deactivateMissingEntries(client, payload.meta.fileStem, activeSourceKeys);
    }

    if (shouldTranslate) {
      for (const { phraseId, entry } of imported) {
        for (const baseLanguage of baseLanguages) {
          const translation = await translateIdiomPhraseEntry({
            apiKey,
            model: translationModel,
            targetLanguage: entry.targetLanguage,
            baseLanguage,
            entry
          });
          await upsertTranslation(client, phraseId, baseLanguage, translation);
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Imported ${imported.length} idiom phrases from ${PHRASES_DIR}`);
    if (shouldTranslate) {
      console.log(`Ensured translations for base languages: ${baseLanguages.join(', ')}`);
    } else {
      console.log('Skipped translation generation');
    }
  } catch (error) {
    await client.query('ROLLBACK');
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
