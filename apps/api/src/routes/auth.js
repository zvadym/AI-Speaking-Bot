import { Router } from 'express';
import { signSession } from '../auth.js';
import { verifyInitData } from '../telegram.js';
import { normalizeBotKey } from '../shared/normalization.js';

export function createAuthRouter(_ctx, helpers) {
  const router = Router();

  router.post('/auth/telegram', async (req, res) => {
    const { initData } = req.body || {};
    const result = verifyInitData(initData);
    if (!result.ok) {
      console.warn('auth/telegram failed', {
        reason: result.reason,
        hasInitData: Boolean(initData),
        initDataLength: typeof initData === 'string' ? initData.length : 0,
        origin: req.headers.origin,
        ua: req.headers['user-agent']
      });
      return res.status(401).json({ error: result.reason });
    }

    const user = result.user;
    if (!user?.id) {
      console.warn('auth/telegram missing user', {
        origin: req.headers.origin,
        ua: req.headers['user-agent']
      });
      return res.status(400).json({ error: 'missing_user' });
    }

    await helpers.upsertUser(user, { botKey: result.botKey || null });
    await helpers.recordActionEventSafe({
      chatId: user.id,
      botKey: result.botKey || null,
      actionType: 'start',
      source: 'auth_telegram',
      idempotencyKey: `start:${user.id}`,
      occurredAt: Number.isFinite(result.authDate) ? new Date(result.authDate * 1000) : null
    });

    const authBotKey = normalizeBotKey(result.botKey || null);
    const token = signSession({ chatId: user.id, username: user.username || null, botKey: authBotKey || undefined });
    console.info('auth/telegram ok', {
      chatId: user.id,
      username: user.username || null
    });
    return res.json({
      token,
      bot_key: authBotKey,
      user: { id: user.id, username: user.username || null, first_name: user.first_name || null }
    });
  });

  return router;
}
