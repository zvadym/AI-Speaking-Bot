import jwt from 'jsonwebtoken';
import { env } from './env.js';

export function signSession(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '2h' });
}

export function createRequireAuth(authEnv = env) {
  return function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'missing_token' });
    }

    try {
      req.auth = jwt.verify(token, authEnv.jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  };
}

export const requireAuth = createRequireAuth(env);
