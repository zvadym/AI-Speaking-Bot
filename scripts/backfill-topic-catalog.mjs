#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { loadBotConfigs } from '../apps/api/src/bot-configs.js';
import { defaultEmojiForTopicId } from '../apps/api/src/topic-catalog.js';
import { generateTopicDraft } from '../apps/api/src/topic-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const topicsDir = path.join(repoRoot, 'deploy', 'topics');
const apiKey = (process.env.OPENAI_API_KEY || '').toString().trim();
const databaseUrl = (process.env.DATABASE_URL || '').toString().trim();
const model = (process.env.TOPIC_GENERATION_MODEL || 'gpt-5.4').toString().trim() || 'gpt-5.4';
const force = process.argv.includes('--force');
const onlyBotArgIndex = process.argv.indexOf('--bot-key');
const onlyBotKey = onlyBotArgIndex >= 0 ? String(process.argv[onlyBotArgIndex + 1] || '').trim().toLowerCase() : '';

if (!apiKey) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

function normalizeLanguageCode(value) {
  const code = (value ?? '').toString().trim().toLowerCase();
  if (!code) return '';
  if (code === 'ua' || code === 'uk-ua' || code === 'ua-ua') return 'uk';
  return code.slice(0, 16);
}

function loadLegacyTemplates(baseLanguageRaw) {
  const baseLanguage = normalizeLanguageCode(baseLanguageRaw) || 'en';
  const candidates = [path.join(topicsDir, `${baseLanguage}.json`)];
  if (baseLanguage !== 'en') candidates.push(path.join(topicsDir, 'en.json'));
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(`Missing legacy topic template file for base language ${baseLanguage}`);
  }
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  return Array.isArray(parsed?.templates) ? parsed.templates : [];
}

function seedTemplateFromLegacy(templateRaw = {}, sortOrder = 0) {
  const topicId = String(templateRaw.id || '').trim().toLowerCase();
  if (!topicId) throw new Error('Legacy template missing id');
  return {
    topic_id: topicId,
    emoji: defaultEmojiForTopicId(topicId),
    access_tier: 'all',
    title_base: String(templateRaw.title || '').trim(),
    goal_base: String(templateRaw.goal || '').trim(),
    allowed_base: Array.isArray(templateRaw.allowed) ? templateRaw.allowed.map((item) => String(item || '').trim()).filter(Boolean) : [],
    avoid_base: Array.isArray(templateRaw.avoid) ? templateRaw.avoid.map((item) => String(item || '').trim()).filter(Boolean) : [],
    sort_order: sortOrder
  };
}

const pool = new Pool({ connectionString: databaseUrl });
const botConfigs = loadBotConfigs();
const botEntries = Object.entries(botConfigs)
  .filter(([botKey]) => !onlyBotKey || botKey === onlyBotKey)
  .sort(([a], [b]) => a.localeCompare(b));

if (!botEntries.length) {
  console.error('No bot configs found to backfill');
  process.exit(1);
}

let created = 0;
let updated = 0;
let skipped = 0;

for (const [botKey, config] of botEntries) {
  const baseLanguage = normalizeLanguageCode(config.base_language || botKey.split('-')[0]);
  const targetLanguage = normalizeLanguageCode(config.learning_language || botKey.split('-')[1]);
  const templates = loadLegacyTemplates(baseLanguage);
  console.log(`Backfilling ${botKey} (${baseLanguage}->${targetLanguage}) with ${templates.length} topic(s)`);

  for (let index = 0; index < templates.length; index += 1) {
    const seed = seedTemplateFromLegacy(templates[index], index);
    const existing = await pool.query(
      `SELECT 1
       FROM bot_topic_catalog
       WHERE bot_key = $1
         AND topic_id = $2
       LIMIT 1`,
      [botKey, seed.topic_id]
    );
    if (!force && existing.rowCount > 0) {
      skipped += 1;
      continue;
    }

    const generated = await generateTopicDraft({
      apiKey,
      model,
      topicName: seed.title_base,
      baseLanguage,
      targetLanguage,
      sortOrder: seed.sort_order,
      accessTier: seed.access_tier,
      baseTemplate: seed
    });

    await pool.query(
      `INSERT INTO bot_topic_catalog (
         bot_key,
         topic_id,
         emoji,
         access_tier,
         title_base,
         goal_base,
         allowed_base,
         avoid_base,
         starter_questions_target,
         recovery_questions_target,
         sort_order,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, NOW())
       ON CONFLICT (bot_key, topic_id) DO UPDATE SET
         emoji = EXCLUDED.emoji,
         access_tier = EXCLUDED.access_tier,
         title_base = EXCLUDED.title_base,
         goal_base = EXCLUDED.goal_base,
         allowed_base = EXCLUDED.allowed_base,
         avoid_base = EXCLUDED.avoid_base,
         starter_questions_target = EXCLUDED.starter_questions_target,
         recovery_questions_target = EXCLUDED.recovery_questions_target,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()`,
      [
        botKey,
        generated.topic_id,
        generated.emoji,
        generated.access_tier,
        generated.title_base,
        generated.goal_base,
        JSON.stringify(generated.allowed_base),
        JSON.stringify(generated.avoid_base),
        JSON.stringify(generated.starter_questions_target),
        JSON.stringify(generated.recovery_questions_target),
        generated.sort_order
      ]
    );

    if (existing.rowCount > 0) updated += 1;
    else created += 1;
  }
}

await pool.end();
console.log(`Topic backfill finished. created=${created} updated=${updated} skipped=${skipped}`);
