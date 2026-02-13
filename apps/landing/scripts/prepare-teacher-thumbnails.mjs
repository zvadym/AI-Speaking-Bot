import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const botsDir = path.resolve(repoRoot, 'deploy/bots');
const sourceDir = path.resolve(repoRoot, 'apps/landing/public/teachers');
const outputDir = path.resolve(sourceDir, 'thumbnail');

const SOURCE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];
const THUMB_SIZE = Number.parseInt(process.env.TEACHER_THUMBNAIL_SIZE || '256', 10) || 256;

function hasCommand(cmd, versionArg = '--version') {
  const probe = spawnSync(cmd, [versionArg], { stdio: 'ignore' });
  return probe.status === 0;
}

function detectProcessor() {
  if (hasCommand('magick')) return 'magick';
  if (hasCommand('convert')) return 'convert';
  if (hasCommand('sips', '-h')) return 'sips';
  return '';
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').toString().trim();
    const stdout = (result.stdout || '').toString().trim();
    const details = stderr || stdout || `exit code ${result.status}`;
    throw new Error(`${command} failed: ${details}`);
  }
}

function detectSource(botKey) {
  for (const ext of SOURCE_EXTS) {
    const candidate = path.resolve(sourceDir, `${botKey}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function buildThumbnail({ processor, source, output }) {
  if (processor === 'magick') {
    run('magick', [
      source,
      '-auto-orient',
      '-thumbnail', `${THUMB_SIZE}x${THUMB_SIZE}^`,
      '-gravity', 'center',
      '-extent', `${THUMB_SIZE}x${THUMB_SIZE}`,
      '-strip',
      output
    ]);
    return;
  }

  if (processor === 'convert') {
    run('convert', [
      source,
      '-auto-orient',
      '-thumbnail', `${THUMB_SIZE}x${THUMB_SIZE}^`,
      '-gravity', 'center',
      '-extent', `${THUMB_SIZE}x${THUMB_SIZE}`,
      '-strip',
      output
    ]);
    return;
  }

  if (processor === 'sips') {
    run('sips', [
      '-s', 'format', 'png',
      '-Z', String(THUMB_SIZE),
      source,
      '--out', output
    ]);
    return;
  }

  const ext = path.extname(source).toLowerCase();
  if (ext === '.png') {
    fs.copyFileSync(source, output);
    return;
  }

  throw new Error(`No image processor found for non-PNG source: ${path.basename(source)}`);
}

function listBotKeys() {
  if (!fs.existsSync(botsDir)) return [];

  return fs.readdirSync(botsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/i, '').toLowerCase())
    .sort();
}

function main() {
  const processor = detectProcessor();
  const botKeys = listBotKeys();

  if (!botKeys.length) {
    console.log('No bot configs found; nothing to thumbnail.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  let generated = 0;
  let missing = 0;

  for (const botKey of botKeys) {
    const source = detectSource(botKey);
    if (!source) {
      missing += 1;
      console.warn(`Missing source image for ${botKey}; expected one of ${SOURCE_EXTS.map((ext) => `${botKey}.${ext}`).join(', ')}`);
      continue;
    }

    const output = path.resolve(outputDir, `${botKey}.png`);
    buildThumbnail({ processor, source, output });
    generated += 1;
  }

  const processorLabel = processor || 'png-copy fallback';
  console.log(`Prepared ${generated} teacher thumbnail(s) using ${processorLabel}. Output: ${path.relative(repoRoot, outputDir)}`);
  if (missing > 0) {
    console.log(`Skipped ${missing} bot(s) due to missing source images.`);
  }
}

main();
