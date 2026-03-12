import { timingSafeEqual } from 'crypto';

function safeEqualString(a, b) {
  const aa = typeof a === 'string' ? a : '';
  const bb = typeof b === 'string' ? b : '';
  const aBuf = Buffer.from(aa);
  const bBuf = Buffer.from(bb);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function createRequireInternalApi(env) {
  return function requireInternalApi(req, res, next) {
    if (!env.internalApiSecret) {
      return res.status(404).json({ error: 'not_found' });
    }

    const provided = (req.headers['x-internal-secret'] || '').toString();
    if (!provided || !safeEqualString(provided, env.internalApiSecret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };
}
