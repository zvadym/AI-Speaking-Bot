# Multi-Bot Schema Design

## Overview

This document describes the database schema changes to support multiple bots per user with per-bot statistics and preferences.

## Key Changes

### 1. `user_bots` Table (NEW)

**Purpose:** Track many-to-many relationship between users and bots with per-bot preferences.

**Schema:**
```sql
user_bots (
  chat_id bigint,           -- FK to users(chat_id)
  bot_key text,             -- Bot identifier (e.g., 'uk-en', 'uk-de')
  
  -- Per-bot preferences (moved from users table)
  level text,               -- Learning level: a1, a2, b1, b2, c1
  reply_mode text,          -- 'text' or 'voice'
  tts_voice text,           -- Voice preference
  onboarding_state text,    -- Onboarding progress per bot
  
  -- Activity tracking
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  is_active boolean,
  
  PRIMARY KEY (chat_id, bot_key)
)
```

**Use Cases:**
- Track which bots a user has activated
- Store per-bot learning level and preferences
- Track last activity per bot for retention analytics
- Query active users per bot

**Example Queries:**

```sql
-- Get all bots for a user
SELECT bot_key, level, last_seen_at 
FROM user_bots 
WHERE chat_id = 12345;

-- Get user's preferences for a specific bot
SELECT level, reply_mode, tts_voice
FROM user_bots
WHERE chat_id = 12345 AND bot_key = 'uk-en';

-- Update last activity when user interacts with a bot
UPDATE user_bots 
SET last_seen_at = NOW(), updated_at = NOW()
WHERE chat_id = 12345 AND bot_key = 'uk-en';
```

---

### 2. Usage Tables (EXTENDED with bot_key)

All usage tracking tables now include `bot_key` to scope statistics per bot:

#### `voice_usage_events`
```sql
ALTER TABLE voice_usage_events ADD COLUMN bot_key text NOT NULL;
-- Primary key remains: id (auto-increment)
-- New indexes: (bot_key, occurred_at), (chat_id, bot_key, occurred_at)
```

**Purpose:** Track every voice interaction event per bot for detailed analytics.

#### `usage_hourly`
```sql
ALTER TABLE usage_hourly ADD COLUMN bot_key text NOT NULL;
-- Primary key changed to: (chat_id, bot_key, hour_start)
-- New index: (bot_key, hour_start)
```

**Purpose:** Aggregate hourly usage per bot for performance dashboards.

#### `usage_week`
```sql
ALTER TABLE usage_week ADD COLUMN bot_key text NOT NULL;
-- Primary key changed to: (chat_id, bot_key, week_start)
-- New index: (bot_key, week_start)
```

**Purpose:** Track weekly usage per bot (note: limits are still global per user).

**Important:** While usage is tracked per bot, subscription limits remain **global** per user across all bots.

---

### 3. Statistics Views (NEW)

#### `bot_stats`
Real-time statistics per bot:
```sql
SELECT * FROM bot_stats;

-- Returns:
-- bot_key | total_users | active_users | users_last_7_days | users_last_30_days | new_users_7_days | ...
-- uk-en   | 1250        | 892          | 345               | 678                | 89               | ...
-- uk-de   | 843         | 521          | 201               | 412                | 45               | ...
```

#### `bot_stats_by_tier`
User distribution by bot and subscription tier:
```sql
SELECT * FROM bot_stats_by_tier ORDER BY bot_key, effective_tier;

-- Returns:
-- bot_key | effective_tier | user_count | active_user_count
-- uk-en   | free           | 980        | 701
-- uk-en   | plus           | 210        | 175
-- uk-en   | pro            | 60         | 58
-- uk-de   | free           | 720        | 450
-- ...
```

#### `bot_dau`
Daily Active Users per bot (last 90 days):
```sql
SELECT * FROM bot_dau WHERE bot_key = 'uk-en' ORDER BY day DESC LIMIT 30;

-- Returns:
-- bot_key | day        | dau
-- uk-en   | 2026-02-09 | 345
-- uk-en   | 2026-02-08 | 389
-- ...
```

---

## Migration Path

### Phase 1: Add new tables and columns (✅ Completed)
- Create `user_bots` table
- Add `bot_key` to usage tables
- Create statistics views
- Backfill existing data

### Phase 2: Update API (TODO)
**Changes needed in `/apps/api/src/server.js`:**

1. **User authentication:** Create/update `user_bots` record when user logs in via Telegram
   ```js
   // In auth/telegram endpoint
   await upsertUserBot(chatId, botKey, { 
     last_seen_at: new Date() 
   });
   ```

2. **Preference endpoints:** Read/write to `user_bots` instead of `users`
   ```js
   // GET /me - return preferences for current bot
   SELECT ub.level, ub.reply_mode, ub.tts_voice
   FROM user_bots ub
   WHERE ub.chat_id = $1 AND ub.bot_key = $2
   
   // POST /me/level - update level for current bot
   UPDATE user_bots 
   SET level = $1, updated_at = NOW()
   WHERE chat_id = $2 AND bot_key = $3
   ```

3. **Usage tracking:** Pass `bot_key` to all usage inserts
   ```js
   // When recording voice usage
   INSERT INTO voice_usage_events (chat_id, bot_key, direction, seconds, ...)
   VALUES ($1, $2, $3, $4, ...)
   ```

4. **Broadcast system:** Already bot-aware (reads `bot_key` from users), update to use `user_bots`
   ```js
   // In processBroadcastCampaign()
   SELECT r.chat_id, ub.bot_key
   FROM broadcast_recipients r
   JOIN user_bots ub ON ub.chat_id = r.chat_id
   WHERE ub.is_active = true
   ```

5. **Admin metrics:** Add bot filter to admin endpoints
   ```js
   // GET /admin/metrics/summary?bot_key=uk-en
   // GET /admin/metrics/active-users-by-day?bot_key=uk-de
   ```

### Phase 3: Update n8n workflows (TODO)
**Changes needed:**

1. **Set bot context early:** In `ai-bot.json` workflow, ensure `bot_key` is set from webhook/trigger
2. **Pass bot_key to API:** Include `bot_key` in all API calls
3. **Plan-changed workflow:** Make it multi-bot aware (add to `BOT_TEMPLATES`)

### Phase 4: Cleanup (TODO - Future migration)
After API is fully updated, remove deprecated columns from `users`:
```sql
-- 20260210_cleanup_users_table.sql
ALTER TABLE users 
  DROP COLUMN IF EXISTS bot_key,          -- Replaced by user_bots table (many-to-many)
  DROP COLUMN IF EXISTS target_lang,      -- Replaced by bot_key format (e.g., 'uk-en' → learning 'en')
  DROP COLUMN IF EXISTS level,            -- Moved to user_bots
  DROP COLUMN IF EXISTS reply_mode,       -- Moved to user_bots
  DROP COLUMN IF EXISTS tts_voice,        -- Moved to user_bots
  DROP COLUMN IF EXISTS onboarding_state, -- Moved to user_bots
  DROP COLUMN IF EXISTS summary;          -- Already moved to user_summaries table
```

---

## Working with bot_key

The `bot_key` format is `<base_language>-<learning_language>`, for example:
- `uk-en` = Ukrainian speaker learning English
- `uk-de` = Ukrainian speaker learning German

### Extracting languages from bot_key

```sql
-- Extract learning language from bot_key
SELECT 
  bot_key,
  split_part(bot_key, '-', 1) as base_language,     -- 'uk'
  split_part(bot_key, '-', 2) as learning_language  -- 'en', 'de'
FROM user_bots;

-- Filter by learning language
SELECT * FROM user_bots 
WHERE split_part(bot_key, '-', 2) = 'en';  -- All English learners

-- Migrate from old target_lang to bot_key
-- Old: WHERE target_lang = 'en'
-- New: WHERE split_part(bot_key, '-', 2) = 'en'
```

### Bot key helper function (optional)

You can create a helper function to extract the learning language:

```sql
CREATE OR REPLACE FUNCTION learning_language(bot_key text)
RETURNS text AS $$
  SELECT split_part(bot_key, '-', 2);
$$ LANGUAGE SQL IMMUTABLE;

-- Usage:
SELECT * FROM user_bots WHERE learning_language(bot_key) = 'en';
```

---

## Common Queries

### Get active users for a specific bot
```sql
SELECT COUNT(*) 
FROM user_bots 
WHERE bot_key = 'uk-en' 
  AND is_active = true
  AND last_seen_at >= NOW() - INTERVAL '30 days';
```

### Get all bots a user has ever used
```sql
SELECT 
  bot_key, 
  split_part(bot_key, '-', 1) as base_language,    -- 'uk'
  split_part(bot_key, '-', 2) as learning_language, -- 'en', 'de', etc.
  first_seen_at, 
  last_seen_at, 
  level
FROM user_bots
WHERE chat_id = 12345
ORDER BY last_seen_at DESC;
```

### Get usage breakdown by bot for last 7 days
```sql
SELECT 
  bot_key,
  SUM(seconds) FILTER (WHERE direction = 'in') as user_seconds,
  SUM(seconds) FILTER (WHERE direction = 'out') as tts_seconds,
  COUNT(*) as event_count
FROM voice_usage_events
WHERE occurred_at >= NOW() - INTERVAL '7 days'
GROUP BY bot_key;
```

### Check which bot a user last interacted with
```sql
SELECT bot_key, last_seen_at
FROM user_bots
WHERE chat_id = 12345
ORDER BY last_seen_at DESC
LIMIT 1;
```

### Get retention by bot (users who returned after first day)
```sql
SELECT 
  ub.bot_key,
  COUNT(DISTINCT ub.chat_id) FILTER (
    WHERE ub.last_seen_at > ub.first_seen_at + INTERVAL '1 day'
  )::float / NULLIF(COUNT(DISTINCT ub.chat_id), 0) * 100 as retention_pct
FROM user_bots ub
WHERE ub.first_seen_at >= NOW() - INTERVAL '30 days'
GROUP BY ub.bot_key;
```

---

## API Endpoint Changes Needed

### Current → New

| Endpoint | Old Query | New Query |
|----------|-----------|-----------|
| `GET /me` | `SELECT level, target_lang, reply_mode FROM users WHERE chat_id = $1` | `SELECT level, reply_mode, split_part(bot_key, '-', 2) as learning_language FROM user_bots WHERE chat_id = $1 AND bot_key = $2` |
| `POST /me/level` | `UPDATE users SET level = $1 WHERE chat_id = $2` | `UPDATE user_bots SET level = $1 WHERE chat_id = $2 AND bot_key = $3` |
| `POST /me/target-lang` | `UPDATE users SET target_lang = $1 WHERE chat_id = $2` | **DEPRECATED** - Language is determined by which bot user starts (bot_key) |
| Usage inserts | `INSERT INTO voice_usage_events (chat_id, ...)` | `INSERT INTO voice_usage_events (chat_id, bot_key, ...)` |
| Broadcasts | `SELECT bot_key FROM users` | `SELECT bot_key FROM user_bots WHERE is_active = true` |

**Note:** `target_lang` is deprecated. The learning language is now encoded in `bot_key`:
- Old: `target_lang = 'en'` → User wants to learn English
- New: `bot_key = 'uk-en'` → User speaks Ukrainian, learning English

---

## Testing Checklist

- [ ] Run migration on staging database
- [ ] Verify backfill: check that all existing users have entries in `user_bots`
- [ ] Verify usage tables: check that `bot_key` is populated for all rows
- [ ] Test statistics views: run sample queries and verify results
- [ ] Update API to use new schema
- [ ] Test multi-bot scenario: single user interacting with both uk-en and uk-de bots
- [ ] Test preference isolation: verify that level/settings for uk-en don't affect uk-de
- [ ] Test admin dashboard: verify bot statistics are accurate
- [ ] Test broadcasts: verify messages sent to correct bot per user

---

## Rollback Plan

If issues arise, you can temporarily fall back to the old schema:

1. API can still read from `users` table (old columns not dropped yet)
2. Usage queries can ignore `bot_key` by using `DISTINCT ON (chat_id, ...)`
3. Full rollback requires dropping new tables/columns (see migrate:down)

However, the migration is designed to be **forward-only** and maintains backward compatibility until Phase 4.
