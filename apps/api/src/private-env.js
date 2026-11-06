import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(moduleDir, '../../..');
// Docker's /app/{src,dist} layout has no monorepo parents.
const checkoutRoot = fs.existsSync(path.join(candidateRoot, 'apps/api'))
  ? candidateRoot
  : path.resolve(moduleDir, '..');

// Containers already receive their environment from Compose. Local commands opt in
// explicitly so tests/builds never discover a developer's production credentials.
export function loadPrivateEnv({ env = process.env, repoRoot = checkoutRoot } = {}) {
  const filename = env.API_ENV_FILE;
  if (!filename) return;
  if (!path.isAbsolute(filename)) throw new Error('API_ENV_FILE must be an absolute path outside the repository');
  const resolved = fs.realpathSync(filename);
  if (fs.statSync(resolved).mode & 0o077) throw new Error('API_ENV_FILE requires mode 0600');
  const relative = path.relative(fs.realpathSync(repoRoot), resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('API_ENV_FILE must be outside the repository');
  }
  for (let parent = path.dirname(resolved); ; parent = path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, '.git'))) throw new Error('API_ENV_FILE must not be inside a Git checkout');
    if (path.dirname(parent) === parent) break;
  }
  const parsed = dotenv.parse(fs.readFileSync(resolved));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
}

loadPrivateEnv();
