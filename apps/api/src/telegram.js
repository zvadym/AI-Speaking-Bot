import crypto from 'crypto';
import { env } from './env.js';

function safeHexBuffer(hex) {
  try {
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
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

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(env.telegramBotToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const expectedBuffer = safeHexBuffer(expectedHash);
  const providedBuffer = safeHexBuffer(hash);
  if (!expectedBuffer || !providedBuffer || expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: 'bad_hash' };
  }

  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
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

  return { ok: true, user, authDate };
}
