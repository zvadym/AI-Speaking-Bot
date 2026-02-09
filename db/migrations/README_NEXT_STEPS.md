# Multi-Bot Implementation: Next Steps

## ✅ What's Been Done (Database Layer)

### 1. Migration Created: `20260209170000_create_user_bots_and_scope_usage.sql`

**New `user_bots` table:**
- Tracks many-to-many relationship between users and bots
- Stores per-bot preferences: `level`, `reply_mode`, `tts_voice`, `onboarding_state`
- Tracks activity: `first_seen_at`, `last_seen_at`, `is_active`
- Backfills from existing `users` table data

**Extended usage tables with `bot_key`:**
- `voice_usage_events` - now scoped per bot
- `usage_hourly` - now scoped per bot
- `usage_week` - now scoped per bot
- All existing data backfilled with correct bot_key

**Statistics views created:**
- `bot_stats` - Real-time user counts, activity, growth per bot
- `bot_stats_by_tier` - User distribution by bot and subscription tier
- `bot_dau` - Daily Active Users per bot (last 90 days)

### 2. Documentation Created
- `MULTI_BOT_SCHEMA.md` - Comprehensive guide with queries, examples, API changes needed

---

## 🔄 Next Steps

### Step 1: Run the Migration

```bash
# On local/staging first
cd /home/developer/WorkProjects/AI-Speaking-Bot
./deploy/migrate.sh

# Or via Docker on server
ssh your-server
cd /path/to/project
./deploy/migrate.sh
```

**Verify migration:**
```sql
-- Check user_bots table was created and populated
SELECT bot_key, COUNT(*) as user_count FROM user_bots GROUP BY bot_key;

-- Check usage tables have bot_key
SELECT bot_key, COUNT(*) FROM voice_usage_events GROUP BY bot_key;

-- Check views work
SELECT * FROM bot_stats;
```

---

### Step 2: Update API Code

**File:** `apps/api/src/server.js`

#### 2.1 Update `resolveUserBotKey()` function

The existing `resolveUserBotKey()` function (line 85-101) uses `users.target_lang` to construct bot_key. Update it to query `user_bots` instead:

```javascript
async function resolveUserBotKey(chatIdRaw) {
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) return normalizeBotKey(env.defaultBotKey);

  // Try to get most recently used bot for this user
  const { rows } = await pool.query(
    `SELECT bot_key
       FROM user_bots
      WHERE chat_id = $1
      ORDER BY last_seen_at DESC
      LIMIT 1`,
    [chatId]
  );

  if (rows[0]?.bot_key) {
    return normalizeBotKey(rows[0].bot_key);
  }

  // Fallback: check old users.bot_key or users.target_lang for backward compatibility
  const { rows: userRows } = await pool.query(
    `SELECT bot_key, target_lang
       FROM users
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId]
  );

  const user = userRows[0];
  if (user?.bot_key) return normalizeBotKey(user.bot_key);
  return botKeyFromTargetLang(user?.target_lang || null);
}
```

#### 2.2 Create helper functions for user_bots table

Add near the top of the file (after existing helper functions):

```javascript
// Upsert user-bot relationship and update last seen
async function upsertUserBot(chatId, botKey, { level, reply_mode, tts_voice, onboarding_state } = {}) {
  const normalizedBotKey = normalizeBotKey(botKey);
  if (!normalizedBotKey) return;
  
  await pool.query(
    `INSERT INTO user_bots (chat_id, bot_key, level, reply_mode, tts_voice, onboarding_state, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (chat_id, bot_key) DO UPDATE SET
       level = COALESCE($3, user_bots.level),
       reply_mode = COALESCE($4, user_bots.reply_mode),
       tts_voice = COALESCE($5, user_bots.tts_voice),
       onboarding_state = COALESCE($6, user_bots.onboarding_state),
       last_seen_at = NOW(),
       is_active = true,
       updated_at = NOW()`,
    [chatId, normalizedBotKey, level, reply_mode, tts_voice, onboarding_state]
  );
}

// Get user preferences for a specific bot
async function getUserBotPreferences(chatId, botKey) {
  const normalizedBotKey = normalizeBotKey(botKey);
  const { rows } = await pool.query(
    `SELECT level, reply_mode, tts_voice, onboarding_state, last_seen_at
     FROM user_bots
     WHERE chat_id = $1 AND bot_key = $2
     LIMIT 1`,
    [chatId, normalizedBotKey]
  );
  return rows[0] || null;
}
```

#### 2.3 Update `upsertUser()` function

```javascript
async function upsertUser(user, { botKey = null } = {}) {
  const chatId = user.id;
  const username = user.username || null;
  const firstName = user.first_name || null;
  const normalizedBotKey = normalizeBotKey(botKey);

  // Upsert user (billing/identity only)
  await pool.query(
    `INSERT INTO users (chat_id, username, first_name, is_active, inactive_reason, inactive_at, last_delivery_error)
     VALUES ($1, $2, $3, true, NULL, NULL, NULL)
     ON CONFLICT (chat_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       is_active = true,
       inactive_reason = NULL,
       inactive_at = NULL,
       last_delivery_error = NULL,
       updated_at = NOW()`,
    [chatId, username, firstName]
  );

  // Upsert user-bot relationship
  if (normalizedBotKey) {
    await upsertUserBot(chatId, normalizedBotKey);
  }
}
```

#### 2.4 Update `/me` endpoint

```javascript
app.get('/me', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const botKey = req.query.bot_key || req.headers['x-bot-key'];
  
  const { rows: userRows } = await pool.query(
    `SELECT chat_id, username, first_name,
            plan_tier, plan_expires_at, plan_autorenew
     FROM users
     WHERE chat_id = $1
     LIMIT 1`,
    [chatId]
  );

  const user = userRows[0] || null;
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  // Get bot-specific preferences if bot_key provided
  let botPreferences = null;
  if (botKey) {
    botPreferences = await getUserBotPreferences(chatId, botKey);
    // Add learning_language extracted from bot_key
    if (botPreferences) {
      botPreferences.learning_language = normalizeBotKey(botKey).split('-')[1] || null;
    }
  }

  return res.json({ 
    user: {
      ...user,
      // Override with bot-specific preferences if available
      ...(botPreferences || {})
    }
  });
});
```

**Note:** `target_lang` is now derived from `bot_key`. For example:
- `bot_key = 'uk-en'` → `learning_language = 'en'`
- `bot_key = 'uk-de'` → `learning_language = 'de'`

#### 2.5 Deprecate `/me/target-lang` endpoint

The `/me/target-lang` endpoint should be **deprecated** or **reimplemented**.

**Option 1: Deprecate (Recommended)**
Users switch languages by starting a different bot (e.g., opening uk-en bot vs uk-de bot):

```javascript
app.post('/me/target-lang', requireAuth, async (req, res) => {
  // Return deprecation notice
  return res.status(410).json({ 
    error: 'endpoint_deprecated',
    message: 'Use different bot to learn different language. Start @YourEnglishBot or @YourGermanBot'
  });
});
```

**Option 2: Switch active bot**
Create/activate user_bots entry for the desired language:

```javascript
app.post('/me/target-lang', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const targetLang = (req.body?.target_lang ?? req.body?.targetLang ?? '').toString().trim().toLowerCase();
  
  if (!['en', 'de'].includes(targetLang)) {
    return res.status(400).json({ error: 'bad_target_lang' });
  }

  // Construct new bot_key (assuming 'uk' base language)
  const newBotKey = `uk-${targetLang}`;
  
  // Create or activate this bot for the user
  await upsertUserBot(chatId, newBotKey, { onboarding_state: 'await_level' });
  
  const preferences = await getUserBotPreferences(chatId, newBotKey);
  return res.json({ 
    bot_key: newBotKey,
    learning_language: targetLang,
    preferences 
  });
});
```

#### 2.6 Update `/me/level` endpoint

```javascript
app.post('/me/level', requireAuth, async (req, res) => {
  const chatId = req.auth.chatId;
  const botKey = req.body.bot_key || req.headers['x-bot-key'];
  const raw = (req.body?.level ?? '').toString().trim().toLowerCase();
  
  if (!['a1', 'a2', 'b1', 'b2', 'c1'].includes(raw)) {
    return res.status(400).json({ error: 'bad_level' });
  }

  if (!botKey) {
    return res.status(400).json({ error: 'bot_key_required' });
  }

  const { rows } = await pool.query(
    `UPDATE user_bots
        SET level = $1,
            onboarding_state = 'ready',
            updated_at = NOW()
      WHERE chat_id = $2 AND bot_key = $3
      RETURNING chat_id, bot_key, level, reply_mode, tts_voice, onboarding_state`,
    [raw, chatId, normalizeBotKey(botKey)]
  );

  if (!rows[0]) return res.status(404).json({ error: 'user_bot_not_found' });
  return res.json({ preferences: rows[0] });
});
```

#### 2.7 Update usage tracking to include bot_key

Search for all `INSERT INTO voice_usage_events` and add `bot_key` column:

```javascript
// Example: wherever you insert voice usage
await pool.query(
  `INSERT INTO voice_usage_events (chat_id, bot_key, direction, seconds, source, occurred_at, message_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [chatId, botKey, direction, seconds, source, occurredAt, messageId]
);
```

#### 2.8 Update broadcast query

In `processBroadcastCampaign()`, change the query to use `user_bots`:

```javascript
const { rows: pendingRows } = await pool.query(
  `SELECT
     r.chat_id,
     ub.bot_key
   FROM broadcast_recipients r
   JOIN user_bots ub ON ub.chat_id = r.chat_id
  WHERE r.campaign_id = $1
    AND r.status = 'pending'
    AND ub.is_active = true
  ORDER BY r.chat_id ASC, ub.bot_key ASC
  LIMIT $2`,
  [id, env.broadcastProcessBatchSize]
);
```

**Note:** This will now send to ALL active bots per user. If you want to send to only ONE bot per user (e.g., their most recently used bot), modify the query:

```sql
-- Option 1: Send to most recently used bot per user
SELECT DISTINCT ON (r.chat_id)
  r.chat_id,
  ub.bot_key
FROM broadcast_recipients r
JOIN user_bots ub ON ub.chat_id = r.chat_id
WHERE r.campaign_id = $1
  AND r.status = 'pending'
  AND ub.is_active = true
ORDER BY r.chat_id ASC, ub.last_seen_at DESC
LIMIT $2
```

---

### Step 3: Update n8n Workflows

#### 3.1 Add `plan-changed.json` to bot templates

**File:** `scripts/render-n8n-workflows.py`

Change line 20-23:
```python
BOT_TEMPLATES = {
    "ai-bot.json": "ai-bot",
    "loader-messages-rotator.json": "loader-messages-rotator",
    "plan-changed.json": "plan-changed",  # ADD THIS LINE
}
```

This will generate `plan-changed-uk-en.json` and `plan-changed-uk-de.json` with proper Telegram credentials.

#### 3.2 Ensure bot_key is passed in all workflow API calls

In `ai-bot.json` workflow, ensure the `Settings` node includes `bot_key` and it's passed to any API endpoints called.

---

### Step 4: Test End-to-End

1. **Test single user, multiple bots:**
   - User starts uk-en bot → check `user_bots` has entry
   - User sets level to B1 in uk-en
   - User starts uk-de bot → check `user_bots` has separate entry
   - User sets level to A2 in uk-de
   - Verify levels are independent

2. **Test usage tracking:**
   - User sends voice message to uk-en
   - Check `voice_usage_events` has correct `bot_key`
   - Repeat with uk-de
   - Verify usage is tracked separately

3. **Test broadcasts:**
   - Create broadcast campaign
   - Verify user receives message on BOTH bots (or only most recent, depending on implementation)

4. **Test statistics:**
   ```sql
   SELECT * FROM bot_stats;
   SELECT * FROM bot_stats_by_tier;
   ```

5. **Test plan change notifications:**
   - User upgrades to Plus
   - Verify they receive notification on their active bot(s)

---

### Step 5: Admin Dashboard Updates

Add bot filter to admin metrics endpoints:

```javascript
app.get('/admin/metrics/summary', requireAdmin, async (req, res) => {
  const botKey = req.query.bot_key; // Add bot filter
  // ... modify query to filter by bot_key if provided
});
```

Create new admin endpoint for bot statistics:

```javascript
app.get('/admin/metrics/bot-stats', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM bot_stats');
  return res.json({ bots: rows });
});

app.get('/admin/metrics/bot-stats-by-tier', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM bot_stats_by_tier ORDER BY bot_key, effective_tier');
  return res.json({ data: rows });
});
```

---

### Step 6: Update Mini-App (if needed)

If the mini-app needs to show per-bot preferences:

```javascript
// When calling GET /me, include bot_key
const response = await fetch(`${API_BASE}/me?bot_key=${currentBotKey}`, {
  headers: { Authorization: `Bearer ${token}` }
});
```

---

## 🔍 Verification Queries

After deployment, run these queries to verify everything works:

```sql
-- 1. Check user_bots population
SELECT bot_key, COUNT(*) as users, COUNT(*) FILTER (WHERE is_active) as active
FROM user_bots GROUP BY bot_key;

-- 2. Check users with multiple bots
SELECT chat_id, COUNT(*) as bot_count, array_agg(bot_key ORDER BY last_seen_at DESC) as bots
FROM user_bots 
GROUP BY chat_id 
HAVING COUNT(*) > 1
LIMIT 20;

-- 3. Check usage tracking has bot_key
SELECT bot_key, COUNT(*) as events, SUM(seconds) as total_seconds
FROM voice_usage_events
WHERE occurred_at >= NOW() - INTERVAL '7 days'
GROUP BY bot_key;

-- 4. Verify statistics views
SELECT * FROM bot_stats;
SELECT * FROM bot_dau WHERE day >= CURRENT_DATE - 7 ORDER BY bot_key, day;
```

---

## 📊 Expected Benefits

After implementation:

✅ **Users can use multiple bots** - uk-en for English, uk-de for German  
✅ **Per-bot preferences** - Different levels for different languages  
✅ **Accurate statistics** - Know which bot is more popular  
✅ **Better retention tracking** - See which bot has better engagement  
✅ **Targeted messaging** - Send broadcasts to specific bot users  
✅ **Clean architecture** - Separation of billing (users) and bot interactions (user_bots)

---

## 🚨 Important Notes

1. **Billing remains global** - A user with Plus plan has Plus on ALL bots
2. **Limits are global** - Weekly usage limits apply across all bots (may want to change this)
3. **Backward compatibility** - Old columns in `users` table are kept until Phase 4
4. **Plan change notifications** - Will need to send to all user's active bots (or just most recent)

---

## Questions to Decide

1. **Broadcast behavior:** Should broadcasts go to:
   - All user's active bots? OR
   - Only their most recently used bot?

2. **Plan change notifications:** Should plan change notifications go to:
   - All user's active bots? OR
   - Only their most recently used bot?

3. **Usage limits:** Should limits be:
   - Global across all bots (current)? OR
   - Per-bot (would require more changes)?

4. **Default bot:** When user first authenticates, which bot should be default?
   - Use `env.defaultBotKey`? OR
   - Require bot_key in Mini App URL?
