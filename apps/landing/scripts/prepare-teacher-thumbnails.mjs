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

function cleanupOldVariants(basePath) {
  for (const ext of ['png', 'webp', 'avif']) {
    const target = `${basePath}.${ext}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

function convertWithImageMagick(processor, source, output, format) {
  const args = [
    source,
    '-auto-orient',
    '-thumbnail', `${THUMB_SIZE}x${THUMB_SIZE}^`,
    '-gravity', 'center',
    '-extent', `${THUMB_SIZE}x${THUMB_SIZE}`,
    '-strip'
  ];

  if (format === 'webp') {
    args.push('-define', 'webp:method=6', '-quality', '82');
  }

  if (format === 'avif') {
    args.push('-quality', '55');
  }

  args.push(output);
  run(processor, args);
}

function buildThumbnailSet({ processor, source, outputBase }) {
  cleanupOldVariants(outputBase);

  const generatedFormats = [];

  if (processor === 'magick' || processor === 'convert') {
    for (const format of ['png', 'webp', 'avif']) {
      const output = `${outputBase}.${format}`;
      convertWithImageMagick(processor, source, output, format);
      generatedFormats.push(format);
    }
    return generatedFormats;
  }

  if (processor === 'sips') {
    const output = `${outputBase}.png`;
    run('sips', [
      '-s', 'format', 'png',
      '-Z', String(THUMB_SIZE),
      source,
      '--out', output
    ]);
    generatedFormats.push('png');
    return generatedFormats;
  }

  const ext = path.extname(source).toLowerCase();
  if (ext === '.png') {
    const output = `${outputBase}.png`;
    fs.copyFileSync(source, output);
    generatedFormats.push('png');
    return generatedFormats;
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
  let generatedVariants = 0;
  let missing = 0;

  for (const botKey of botKeys) {
    const source = detectSource(botKey);
    if (!source) {
      missing += 1;
      console.warn(`Missing source image for ${botKey}; expected one of ${SOURCE_EXTS.map((ext) => `${botKey}.${ext}`).join(', ')}`);
      continue;
    }

    const outputBase = path.resolve(outputDir, botKey);
    const formats = buildThumbnailSet({ processor, source, outputBase });
    generated += 1;
    generatedVariants += formats.length;
  }

  const processorLabel = processor || 'png-copy fallback';
  console.log(
    `Prepared ${generated} teacher thumbnail set(s), ${generatedVariants} file variant(s), using ${processorLabel}. Output: ${path.relative(repoRoot, outputDir)}`
  );
  if (missing > 0) {
    console.log(`Skipped ${missing} bot(s) due to missing source images.`);
  }
}

main();
