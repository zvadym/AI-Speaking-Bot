import crypto from 'crypto';
import { env } from './env.js';

function safeHexBuffer(hex) {
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
}

function verifyInitDataWithToken({ dataCheckString, providedHash }, token) {
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expectedBuffer = safeHexBuffer(expectedHash);
  const providedBuffer = safeHexBuffer(providedHash);
  if (!expectedBuffer || !providedBuffer || expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function candidateTokens() {
  const tokens = [];
  for (const [botKey, token] of Object.entries(env.telegramBotTokensByBotKey || {})) {
    if (!token) continue;
    tokens.push({ botKey, token });
  }
  return tokens;
}

export function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    return { ok: false, reason: 'missing_init_data' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, reason: 'missing_hash' };
  }

  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  const verification = { dataCheckString, providedHash: hash };
  let matchedBotKey = null;
  let ok = false;
  for (const candidate of candidateTokens()) {
    if (verifyInitDataWithToken(verification, candidate.token)) {
      matchedBotKey = candidate.botKey;
      ok = true;
      break;
    }
  }

  if (!ok) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'bad_auth_date' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - authDate;
  if (age < 0 || age > env.telegramInitDataMaxAgeSec) {
    return { ok: false, reason: 'expired' };
  }

  let user = null;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      return { ok: false, reason: 'bad_user_json' };
    }
  }

  return { ok: true, user, authDate, botKey: matchedBotKey };
}
