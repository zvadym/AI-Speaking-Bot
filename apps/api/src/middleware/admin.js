import { timingSafeEqual } from 'crypto';

function safeEqualString(a, b) {
  const aa = typeof a === 'string' ? a : '';
  const bb = typeof b === 'string' ? b : '';
  const aBuf = Buffer.from(aa);
  const bBuf = Buffer.from(bb);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function createRequireAdmin(env) {
  return function requireAdmin(req, res, next) {
    if (!env.adminDashboardPassword) {
      return res.status(404).json({ error: 'not_found' });
    }

    const provided = (req.headers['x-admin-password'] || '').toString();
    if (!provided || !safeEqualString(provided, env.adminDashboardPassword)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };
}
