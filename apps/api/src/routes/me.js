import { Router } from 'express';
import { createRequireAuth } from '../auth.js';
import { enqueueDiscordEventNotificationJob } from '../jobs.js';
import {
  normalizeBotKey,
  normalizeFeedbackCategory
} from '../shared/normalization.js';

export function createMeRouter(ctx, helpers) {
  const router = Router();
  const requireAuth = createRequireAuth(ctx.env);

  router.get('/me', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
    const user = await helpers.getMeUserRow(chatId, requestedBotKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ user });
  });

  router.post('/me/preferences/billing-currency', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const preferredCurrency = helpers.supportedBillingCurrencyCodes.has(String(req.body?.currency || '').toUpperCase())
      ? String(req.body?.currency || '').toUpperCase()
      : null;
    if (!preferredCurrency) {
      return res.status(400).json({ error: 'bad_currency' });
    }

    const { rows } = await ctx.pool.query(
      `UPDATE users
          SET preferred_billing_currency = $1,
              updated_at = NOW()
        WHERE chat_id = $2
        RETURNING preferred_billing_currency`,
      [preferredCurrency, chatId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });

    return res.json({
      preferred_billing_currency: rows[0].preferred_billing_currency || preferredCurrency
    });
  });

  router.get('/me/dashboard', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);
    const user = await helpers.getMeUserRow(chatId, requestedBotKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const [usage, streak, feedbackSummary, xp] = await Promise.all([
      helpers.getUserUsageSummary(chatId),
      helpers.getUserStreakSummary(chatId),
      helpers.getUserFeedbackSummary(chatId, user.bot_key),
      helpers.getUserXpSummary(chatId, user.bot_key)
    ]);

    return res.json({
      user: {
        chat_id: user.chat_id,
        username: user.username || null,
        first_name: user.first_name || null,
        plan_tier: user.plan_tier || 'free'
      },
      selected_bot: {
        bot_key: user.bot_key,
        bot_name: user.bot_name || null,
        learning_language: user.learning_language || null,
        base_language: user.base_language || null,
        level: user.level || 'a1',
        telegram_url: user.telegram_url || null,
        reply_mode: user.reply_mode || 'text',
        tts_voice: user.tts_voice || 'marin',
        teacher_avatar_emoji: user.teacher_avatar_emoji || null,
        teacher_tagline_uk: user.teacher_tagline_uk || null,
        teacher_tagline_en: user.teacher_tagline_en || null,
        teacher_tagline_it: user.teacher_tagline_it || null,
        teacher_style_tags: user.teacher_style_tags || null
      },
      streak,
      xp,
      usage,
      feedback_summary: feedbackSummary
    });
  });

  router.get('/me/bots', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null);

    const [userBots, user] = await Promise.all([
      helpers.listUserBots(chatId),
      helpers.getMeUserRow(chatId, requestedBotKey)
    ]);

    return res.json({
      selected_bot_key: user?.bot_key || requestedBotKey || null,
      bots: userBots,
      available_bots: helpers.listAvailableBotsForUser(userBots)
    });
  });

  router.get('/me/feedback-thread', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await helpers.resolveUserBotKey(chatId);
    const botKey = requestedBotKey || normalizeBotKey(ctx.env.defaultBotKey) || 'uk-de';
    const thread = await helpers.getUserFeedbackThread(chatId, botKey);
    return res.json(thread);
  });

  router.post('/me/feedbacks', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await helpers.resolveUserBotKey(chatId);
    const botKey = requestedBotKey || normalizeBotKey(ctx.env.defaultBotKey) || 'uk-de';
    const category = normalizeFeedbackCategory(req.body?.category);
    const message = (req.body?.message ?? '').toString().trim();

    if (!category) {
      return res.status(400).json({ error: 'bad_feedback_category' });
    }
    if (!message) {
      return res.status(400).json({ error: 'feedback_message_required' });
    }
    if (message.length > helpers.MINIAPP_FEEDBACK_MESSAGE_MAX_LEN) {
      return res.status(400).json({ error: 'feedback_message_too_long' });
    }

    const user = await helpers.getMeUserRow(chatId, botKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const { rows } = await ctx.pool.query(
      `INSERT INTO feedback (
         chat_id,
         username,
         first_name,
         kind,
         feedback_text,
         bot_key,
         category,
         source
       )
       VALUES ($1, $2, $3, 'text', $4, $5, $6, 'miniapp')
       RETURNING id, created_at, feedback_text, category`,
      [
        chatId,
        user.username || null,
        user.first_name || null,
        message,
        botKey,
        category
      ]
    );

    await ctx.pool.query(
      `INSERT INTO feedback_threads (
         chat_id,
         bot_key,
         archived_at,
         archived_by,
         user_last_read_at
       )
       VALUES ($1, $2, NULL, NULL, NOW())
       ON CONFLICT (chat_id, bot_key) DO UPDATE
         SET archived_at = NULL,
             archived_by = NULL,
             user_last_read_at = NOW()`,
      [chatId, botKey]
    );

    const feedbackRow = rows[0] || null;

    if (feedbackRow && ctx.apiBoss && ctx.env.discordEventsWebhookUrl) {
      await enqueueDiscordEventNotificationJob(
        ctx.apiBoss,
        {
          type: 'user_feedback',
          feedback_id: Number(feedbackRow.id || 0) || null,
          chat_id: chatId,
          username: user.username || null,
          first_name: user.first_name || null,
          bot_key: botKey,
          category: feedbackRow.category || category,
          feedback_text: feedbackRow.feedback_text || message,
          kind: 'text',
          source: 'miniapp'
        }
      );
    }

    const feedbackSummary = await helpers.getUserFeedbackSummary(chatId, botKey);

    return res.status(201).json({
      bot_key: botKey,
      item: feedbackRow ? {
        id: Number(feedbackRow.id || 0),
        kind: 'feedback',
        sender: 'user',
        category: feedbackRow.category || category,
        text: feedbackRow.feedback_text || message,
        created_at: feedbackRow.created_at
      } : null,
      feedback_summary: feedbackSummary
    });
  });

  router.post('/me/feedback-thread/read', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const requestedBotKey = helpers.requestedBotKeyFromReq(req) || normalizeBotKey(req.auth?.botKey || null) || await helpers.resolveUserBotKey(chatId);
    const botKey = requestedBotKey || normalizeBotKey(ctx.env.defaultBotKey) || 'uk-de';

    await ctx.pool.query(
      `INSERT INTO feedback_threads (
         chat_id,
         bot_key,
         archived_at,
         archived_by,
         user_last_read_at
       )
       VALUES ($1, $2, NULL, NULL, NOW())
       ON CONFLICT (chat_id, bot_key) DO UPDATE
         SET user_last_read_at = NOW()`,
      [chatId, botKey]
    );

    const feedbackSummary = await helpers.getUserFeedbackSummary(chatId, botKey);
    return res.json({
      bot_key: botKey,
      user_last_read_at: feedbackSummary.user_last_read_at,
      unread_admin_replies: feedbackSummary.unread_admin_replies
    });
  });

  router.post('/me/target-lang', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const raw = (req.body?.target_lang ?? req.body?.targetLang ?? '').toString().trim().toLowerCase();
    if (!['en', 'de'].includes(raw)) {
      return res.status(400).json({ error: 'bad_target_lang' });
    }

    const targetBotKey = helpers.botKeyFromTargetLang(raw) || normalizeBotKey(ctx.env.defaultBotKey) || 'uk-de';

    const { rowCount } = await ctx.pool.query(
       `INSERT INTO user_bots (
         chat_id,
         bot_key,
         level,
         reply_mode,
         tts_voice,
         first_seen_at,
         last_seen_at,
         is_active,
         updated_at
       )
       SELECT $1, $2, 'a1', 'voice', 'marin', NOW(), NOW(), true, NOW()
       FROM users u
       WHERE u.chat_id = $1
       ON CONFLICT (chat_id, bot_key)
       DO UPDATE SET
         last_seen_at = NOW(),
         is_active = true,
         updated_at = NOW()`,
      [chatId, targetBotKey]
    );

    if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
    const user = await helpers.getMeUserRow(chatId, targetBotKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ user });
  });

  router.post('/me/level', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const raw = (req.body?.level ?? '').toString().trim().toLowerCase();
    if (!['a1', 'a2', 'b1', 'b2', 'c1'].includes(raw)) {
      return res.status(400).json({ error: 'bad_level' });
    }

    const currentBotKey =
      helpers.requestedBotKeyFromReq(req) ||
      normalizeBotKey(req.auth?.botKey || null) ||
      await helpers.resolveUserBotKey(chatId) ||
      normalizeBotKey(ctx.env.defaultBotKey) ||
      'uk-de';

    const { rowCount } = await ctx.pool.query(
      `INSERT INTO user_bots (
         chat_id,
         bot_key,
         level,
         reply_mode,
         tts_voice,
         first_seen_at,
         last_seen_at,
         is_active,
         updated_at
       )
       SELECT $1, $2, $3, 'text', 'marin', NOW(), NOW(), true, NOW()
       FROM users u
       WHERE u.chat_id = $1
       ON CONFLICT (chat_id, bot_key)
       DO UPDATE SET
         level = EXCLUDED.level,
         last_seen_at = NOW(),
         is_active = true,
         updated_at = NOW()`,
      [chatId, currentBotKey, raw]
    );

    if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
    const user = await helpers.getMeUserRow(chatId, currentBotKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    await helpers.recordActionEventSafe({
      chatId,
      botKey: currentBotKey,
      actionType: 'profile_set_level',
      source: 'api',
      idempotencyKey: `profile_set_level:${chatId}`,
      properties: { level: raw, via: 'miniapp' }
    });

    return res.json({ user });
  });

  router.post('/me/reply-mode', requireAuth, async (req, res) => {
    const chatId = req.auth.chatId;
    const raw = (req.body?.reply_mode ?? req.body?.replyMode ?? '').toString().trim().toLowerCase();
    if (!['text', 'voice'].includes(raw)) {
      return res.status(400).json({ error: 'bad_reply_mode' });
    }

    const currentBotKey =
      helpers.requestedBotKeyFromReq(req) ||
      normalizeBotKey(req.auth?.botKey || null) ||
      await helpers.resolveUserBotKey(chatId) ||
      normalizeBotKey(ctx.env.defaultBotKey) ||
      'uk-de';

    const { rowCount } = await ctx.pool.query(
      `INSERT INTO user_bots (
         chat_id,
         bot_key,
         level,
         reply_mode,
         tts_voice,
         first_seen_at,
         last_seen_at,
         is_active,
         updated_at
       )
       SELECT $1, $2, 'a1', $3, 'marin', NOW(), NOW(), true, NOW()
       FROM users u
       WHERE u.chat_id = $1
       ON CONFLICT (chat_id, bot_key)
       DO UPDATE SET
         reply_mode = EXCLUDED.reply_mode,
         last_seen_at = NOW(),
         is_active = true,
         updated_at = NOW()`,
      [chatId, currentBotKey, raw]
    );

    if (!rowCount) return res.status(404).json({ error: 'user_not_found' });
    const user = await helpers.getMeUserRow(chatId, currentBotKey);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    await helpers.recordActionEventSafe({
      chatId,
      botKey: currentBotKey,
      actionType: 'profile_set_reply_mode',
      source: 'api',
      idempotencyKey: `profile_set_reply_mode:${chatId}`,
      properties: { reply_mode: raw, via: 'miniapp' }
    });

    return res.json({ user });
  });

  return router;
}
