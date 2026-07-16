#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOTE_HOST = 'langbot-de-1';
const API_CONTAINER = 'languagebot-api-1';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

const REMOTE_QUERY_SCRIPT = String.raw`
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const botKey = process.env.EXPORT_BOT_KEY;
const username = process.env.EXPORT_USERNAME;
const limit = Number(process.env.EXPORT_LIMIT);
const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const rejectUnauthorized = String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized } } : {})
});

try {
  const userResult = await pool.query(
    'SELECT chat_id, username FROM users WHERE lower(username) = lower($1) ORDER BY created_at LIMIT 1',
    [username]
  );

  if (userResult.rows.length === 0) {
    console.log(JSON.stringify({ status: 'user_not_found', username }));
  } else {
    const user = userResult.rows[0];
    const [usageResult, retainedCountResult, jobsResult] = await Promise.all([
      pool.query(
        [
          'SELECT COUNT(*)::int AS historical_inbound_count,',
          'MIN(occurred_at) AS historical_oldest_at,',
          'MAX(occurred_at) AS historical_newest_at',
          'FROM voice_usage_events',
          "WHERE chat_id = $1 AND bot_key = $2 AND direction = 'in'"
        ].join(' '),
        [user.chat_id, botKey]
      ),
      pool.query(
        [
          'SELECT COUNT(*)::int AS retained_voice_count',
          'FROM pgboss.job',
          "WHERE name = 'bot-update-process'",
          "AND data #>> '{contract,botKey}' = $1",
          "AND data #>> '{contract,route}' = 'message.voice'",
          "AND (data #>> '{contract,input,chatId}')::bigint = $2"
        ].join(' '),
        [botKey, user.chat_id]
      ),
      pool.query(
        [
          'SELECT created_on,',
          "data #>> '{contract,updateId}' AS update_id,",
          "data #>> '{contract,input,message,voiceFileId}' AS file_id,",
          "data #>> '{contract,input,message,voiceDuration}' AS duration",
          'FROM pgboss.job',
          "WHERE name = 'bot-update-process'",
          "AND data #>> '{contract,botKey}' = $1",
          "AND data #>> '{contract,route}' = 'message.voice'",
          "AND (data #>> '{contract,input,chatId}')::bigint = $2",
          "AND NULLIF(data #>> '{contract,input,message,voiceFileId}', '') IS NOT NULL",
          'ORDER BY created_on DESC',
          'LIMIT $3'
        ].join(' '),
        [botKey, user.chat_id, limit]
      )
    ]);

    const usage = usageResult.rows[0] || {};
    console.log(JSON.stringify({
      status: 'ok',
      chat_id: String(user.chat_id),
      username: user.username,
      historical_inbound_count: Number(usage.historical_inbound_count || 0),
      historical_oldest_at: usage.historical_oldest_at || null,
      historical_newest_at: usage.historical_newest_at || null,
      retained_voice_count: Number(retainedCountResult.rows[0]?.retained_voice_count || 0),
      jobs: jobsResult.rows.map((row) => ({
        created_at: row.created_on,
        update_id: row.update_id,
        file_id: row.file_id,
        duration: Number(row.duration || 0)
      }))
    }));
  }
} catch (error) {
  console.error(String(error?.message || 'remote_query_failed').slice(0, 500));
  process.exitCode = 1;
} finally {
  await pool.end();
}
`;

function usage(exitCode = 0) {
  const output = [
    'Usage:',
    '  export-telegram-ogg.mjs --bot-key <key> --username <name> [--limit <1-100>] [--dry-run]',
    '',
    `Default limit: ${DEFAULT_LIMIT}`
  ].join('\n');
  (exitCode === 0 ? console.log : console.error)(output);
  process.exit(exitCode);
}

function fail(message) {
  console.error(`ERROR=${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { botKey: '', username: '', limit: DEFAULT_LIMIT, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage(0);
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (arg === '--bot-key' || arg === '--username' || arg === '--limit') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`missing_value_for_${arg.slice(2).replaceAll('-', '_')}`);
      index += 1;
      if (arg === '--bot-key') result.botKey = value.trim().toLowerCase();
      if (arg === '--username') result.username = value.trim().replace(/^@/, '');
      if (arg === '--limit') result.limit = Number(value);
      continue;
    }
    fail(`unknown_argument:${arg}`);
  }

  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(result.botKey)) fail('invalid_or_missing_bot_key');
  if (!/^[A-Za-z0-9_]{1,64}$/.test(result.username)) fail('invalid_or_missing_username');
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > MAX_LIMIT) {
    fail(`limit_must_be_between_1_and_${MAX_LIMIT}`);
  }

  return result;
}

function repoRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../../../..');
  if (!fs.existsSync(path.join(root, 'deploy', 'bots'))) fail('repository_root_not_found');
  return root;
}

function loadBotToken(root, botKey) {
  const configPath = path.join(root, 'deploy', 'bots', `${botKey}.json`);
  if (!fs.existsSync(configPath)) fail(`bot_config_not_found:${botKey}`);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    fail(`bot_config_invalid_json:${botKey}`);
  }

  const token = String(config?.telegram_bot_token || '').trim();
  if (!token || token.startsWith('YOUR_')) fail(`telegram_bot_token_missing:${botKey}`);
  return token;
}

function queryProduction({ botKey, username, limit }) {
  const command = [
    'docker exec -i',
    `-e EXPORT_BOT_KEY=${botKey}`,
    `-e EXPORT_USERNAME=${username}`,
    `-e EXPORT_LIMIT=${limit}`,
    API_CONTAINER,
    'node --input-type=module'
  ].join(' ');
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', REMOTE_HOST, command],
    { input: REMOTE_QUERY_SCRIPT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.error) fail(`ssh_failed:${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || 'remote_query_failed').trim().slice(0, 500);
    fail(`remote_query_failed:${detail}`);
  }

  try {
    return JSON.parse(String(result.stdout || '').trim());
  } catch {
    fail('remote_query_returned_invalid_json');
  }
}

async function telegramApi(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status below is sufficient and avoids logging response bodies.
  }
  if (!response.ok || !payload?.ok) {
    const description = String(payload?.description || `telegram_http_${response.status}`).slice(0, 200);
    throw new Error(description);
  }
  return payload.result;
}

async function downloadVoice(token, fileId) {
  const file = await telegramApi(token, 'getFile', { file_id: fileId });
  const filePath = String(file?.file_path || '').trim();
  if (!filePath || filePath.includes('..')) throw new Error('telegram_file_path_missing');

  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) throw new Error(`telegram_file_http_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer.subarray(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('downloaded_file_is_not_ogg');
  }
  return buffer;
}

function safeTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'unknown-time';
  return date.toISOString().replace(/[:.]/g, '-');
}

function printDiscovery(data, requestedLimit) {
  console.log(`BOT_KEY=${data.bot_key}`);
  console.log(`USERNAME=${data.username}`);
  console.log(`CHAT_ID=${data.chat_id}`);
  console.log(`REQUESTED_LIMIT=${requestedLimit}`);
  console.log(`SELECTED_COUNT=${data.jobs.length}`);
  console.log(`RETAINED_VOICE_COUNT=${data.retained_voice_count}`);
  console.log(`HISTORICAL_INBOUND_COUNT=${data.historical_inbound_count}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const token = loadBotToken(root, args.botKey);
  const data = queryProduction(args);

  if (data.status === 'user_not_found') fail(`telegram_user_not_found:${args.username}`);
  if (data.status !== 'ok') fail('unexpected_remote_query_status');

  data.bot_key = args.botKey;
  printDiscovery(data, args.limit);
  if (args.dryRun) {
    console.log('DRY_RUN=true');
    return;
  }
  if (!Array.isArray(data.jobs) || data.jobs.length === 0) fail('no_retained_voice_files');

  const exportsDir = path.join(root, '.codex', 'exports');
  const exportedAt = new Date();
  const folderName = `telegram-${args.username}-${args.botKey}-${safeTimestamp(exportedAt)}`;
  const finalDir = path.join(exportsDir, folderName);
  const tempDir = `${finalDir}.tmp-${process.pid}`;
  const zipPath = `${finalDir}.zip`;
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(tempDir);

  const files = [];
  try {
    for (let index = 0; index < data.jobs.length; index += 1) {
      const job = data.jobs[index];
      const duration = Number.isFinite(Number(job.duration)) ? Math.max(0, Math.round(Number(job.duration))) : 0;
      const filename = `${String(index + 1).padStart(2, '0')}_${safeTimestamp(job.created_at)}_${duration}s.ogg`;
      const buffer = await downloadVoice(token, job.file_id);
      fs.writeFileSync(path.join(tempDir, filename), buffer);
      files.push({
        filename,
        created_at_utc: new Date(job.created_at).toISOString(),
        duration_seconds: duration,
        bytes: buffer.length
      });
    }

    const manifest = {
      bot_key: args.botKey,
      username: data.username || args.username,
      chat_id: Number(data.chat_id),
      exported_at: exportedAt.toISOString(),
      requested_limit: args.limit,
      historical_inbound_count: data.historical_inbound_count,
      retained_voice_count: data.retained_voice_count,
      exported_count: files.length,
      files
    };
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(tempDir, finalDir);

    const zipResult = spawnSync('zip', ['-qr', zipPath, folderName], {
      cwd: exportsDir,
      encoding: 'utf8'
    });
    if (zipResult.error || zipResult.status !== 0) {
      fs.rmSync(zipPath, { force: true });
      throw new Error(`zip_failed:${String(zipResult.stderr || zipResult.error?.message || '').trim()}`);
    }
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    fail(`export_failed:${String(error?.message || error).slice(0, 300)}`);
  }

  console.log(`EXPORTED_COUNT=${files.length}`);
  console.log(`EXPORT_DIRECTORY=${finalDir}`);
  console.log(`MANIFEST_PATH=${path.join(finalDir, 'manifest.json')}`);
  console.log(`ZIP_PATH=${zipPath}`);
}

await main();
