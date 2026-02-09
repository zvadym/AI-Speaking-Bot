-- migrate:up

-- ==============================================================================
-- Multi-Bot Support Migration
-- ==============================================================================
-- This migration enables users to interact with multiple bots (e.g., uk-en and uk-de).
-- 
-- Context: Currently, all existing users only use the uk-de bot.
-- All backfills in this migration use 'uk-de' as the bot_key for existing data.
--
-- Future bots (e.g., uk-en) will be added as users start interacting with them.
-- ==============================================================================

-- ==============================================================================
-- 1. Create user_bots table: many-to-many relationship between users and bots
-- ==============================================================================
-- bot_key format: "<base_language>-<learning_language>" (e.g., 'uk-en', 'uk-de')
-- This replaces both users.bot_key (single bot) and users.target_lang (learning language)
-- Learning language can be extracted: split_part(bot_key, '-', 2) → 'en', 'de', etc.

CREATE TABLE IF NOT EXISTS public.user_bots (
  chat_id bigint NOT NULL,
  bot_key text NOT NULL,
  
  -- Bot-specific user preferences (moved from users table)
  level text NOT NULL DEFAULT 'a1',
  reply_mode text NOT NULL DEFAULT 'text',
  tts_voice text NOT NULL DEFAULT 'marin',
  onboarding_state text NOT NULL DEFAULT 'ready',
  
  -- Activity tracking per bot
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT user_bots_pkey PRIMARY KEY (chat_id, bot_key),
  CONSTRAINT user_bots_user_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE,
  CONSTRAINT user_bots_level_check CHECK (level IN ('a1', 'a2', 'b1', 'b2', 'c1')),
  CONSTRAINT user_bots_reply_mode_check CHECK (reply_mode IN ('text', 'voice'))
);

CREATE INDEX IF NOT EXISTS idx_user_bots_bot_key ON public.user_bots (bot_key);
CREATE INDEX IF NOT EXISTS idx_user_bots_last_seen ON public.user_bots (bot_key, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_bots_active ON public.user_bots (bot_key, is_active) WHERE is_active = true;


-- ==============================================================================
-- 2. Backfill user_bots from existing users table
-- ==============================================================================

-- All existing users currently only have uk-de bot connected.
-- Create user_bots entry for each user with their uk-de bot preferences.
INSERT INTO public.user_bots (
  chat_id,
  bot_key,
  level,
  reply_mode,
  tts_voice,
  onboarding_state,
  first_seen_at,
  last_seen_at,
  is_active,
  created_at,
  updated_at
)
SELECT
  u.chat_id,
  'uk-de' AS bot_key,  -- All existing users use uk-de bot
  LOWER(COALESCE(u.level, 'a1')) AS level,  -- Convert to lowercase to match constraint
  COALESCE(u.reply_mode, 'text') AS reply_mode,
  COALESCE(u.tts_voice, 'marin') AS tts_voice,
  COALESCE(u.onboarding_state, 'ready') AS onboarding_state,
  COALESCE(u.created_at, NOW()) AS first_seen_at,
  COALESCE(u.updated_at, NOW()) AS last_seen_at,
  COALESCE(u.is_active, true) AS is_active,
  COALESCE(u.created_at, NOW()) AS created_at,
  COALESCE(u.updated_at, NOW()) AS updated_at
FROM public.users u
ON CONFLICT (chat_id, bot_key) DO UPDATE SET
  level = EXCLUDED.level,
  reply_mode = EXCLUDED.reply_mode,
  tts_voice = EXCLUDED.tts_voice,
  onboarding_state = EXCLUDED.onboarding_state,
  last_seen_at = EXCLUDED.last_seen_at,
  is_active = EXCLUDED.is_active,
  updated_at = EXCLUDED.updated_at;


-- ==============================================================================
-- 3. Add bot_key to usage tracking tables
-- ==============================================================================

-- Add bot_key to voice_usage_events
ALTER TABLE public.voice_usage_events
  ADD COLUMN IF NOT EXISTS bot_key text;

-- Backfill bot_key: all existing usage is from uk-de bot
UPDATE public.voice_usage_events
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.voice_usage_events
  ALTER COLUMN bot_key SET NOT NULL,
  ALTER COLUMN bot_key SET DEFAULT 'uk-de';

CREATE INDEX IF NOT EXISTS idx_voice_usage_events_bot_occurred
  ON public.voice_usage_events (bot_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_usage_events_chat_bot_occurred
  ON public.voice_usage_events (chat_id, bot_key, occurred_at DESC);


-- Add bot_key to usage_hourly
ALTER TABLE public.usage_hourly
  ADD COLUMN IF NOT EXISTS bot_key text;

-- Backfill bot_key: all existing usage is from uk-de bot
UPDATE public.usage_hourly
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.usage_hourly
  ALTER COLUMN bot_key SET NOT NULL,
  ALTER COLUMN bot_key SET DEFAULT 'uk-de';

-- Recreate primary key to include bot_key
ALTER TABLE public.usage_hourly
  DROP CONSTRAINT IF EXISTS usage_hourly_pkey;

ALTER TABLE public.usage_hourly
  ADD CONSTRAINT usage_hourly_pkey PRIMARY KEY (chat_id, bot_key, hour_start);

CREATE INDEX IF NOT EXISTS idx_usage_hourly_bot_hour
  ON public.usage_hourly (bot_key, hour_start);


-- Add bot_key to usage_week (weekly limits are still global per user, but track per-bot usage)
ALTER TABLE public.usage_week
  ADD COLUMN IF NOT EXISTS bot_key text;

-- Backfill bot_key: all existing usage is from uk-de bot
UPDATE public.usage_week
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.usage_week
  ALTER COLUMN bot_key SET NOT NULL,
  ALTER COLUMN bot_key SET DEFAULT 'uk-de';

-- Recreate primary key to include bot_key
ALTER TABLE public.usage_week
  DROP CONSTRAINT IF EXISTS usage_week_pkey;

ALTER TABLE public.usage_week
  ADD CONSTRAINT usage_week_pkey PRIMARY KEY (chat_id, bot_key, week_start);

CREATE INDEX IF NOT EXISTS idx_usage_week_bot_week
  ON public.usage_week (bot_key, week_start);


-- ==============================================================================
-- 4. Create views for bot statistics
-- ==============================================================================

-- View: Bot usage statistics (how many users use each bot)
CREATE OR REPLACE VIEW public.bot_stats AS
SELECT
  ub.bot_key,
  COUNT(DISTINCT ub.chat_id) AS total_users,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.is_active) AS active_users,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.last_seen_at >= NOW() - INTERVAL '7 days') AS users_last_7_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.last_seen_at >= NOW() - INTERVAL '30 days') AS users_last_30_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.created_at >= NOW() - INTERVAL '7 days') AS new_users_7_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.created_at >= NOW() - INTERVAL '30 days') AS new_users_30_days,
  MIN(ub.first_seen_at) AS first_user_at,
  MAX(ub.last_seen_at) AS last_activity_at
FROM public.user_bots ub
GROUP BY ub.bot_key;

COMMENT ON VIEW public.bot_stats IS 'Real-time statistics per bot: user counts, activity, and growth metrics';


-- View: Bot usage by tier (how many paid vs free users per bot)
CREATE OR REPLACE VIEW public.bot_stats_by_tier AS
SELECT
  ub.bot_key,
  CASE
    WHEN u.override_plan_tier IS NOT NULL
         AND u.override_expires_at IS NOT NULL
         AND NOW() < u.override_expires_at
      THEN u.override_plan_tier
    WHEN u.plan_expires_at IS NOT NULL
         AND NOW() < u.plan_expires_at
      THEN u.plan_tier
    ELSE 'free'
  END AS effective_tier,
  COUNT(DISTINCT ub.chat_id) AS user_count,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.is_active) AS active_user_count
FROM public.user_bots ub
JOIN public.users u ON u.chat_id = ub.chat_id
GROUP BY ub.bot_key, effective_tier;

COMMENT ON VIEW public.bot_stats_by_tier IS 'User distribution by bot and subscription tier';


-- View: Bot daily active users (DAU)
CREATE OR REPLACE VIEW public.bot_dau AS
SELECT
  ub.bot_key,
  date_trunc('day', v.occurred_at AT TIME ZONE 'UTC')::date AS day,
  COUNT(DISTINCT v.chat_id) AS dau
FROM public.voice_usage_events v
JOIN public.user_bots ub ON ub.chat_id = v.chat_id AND ub.bot_key = v.bot_key
WHERE v.occurred_at >= NOW() - INTERVAL '90 days'
GROUP BY ub.bot_key, day
ORDER BY ub.bot_key, day DESC;

COMMENT ON VIEW public.bot_dau IS 'Daily Active Users per bot (last 90 days)';


-- ==============================================================================
-- 5. Keep users table lean (remove bot-specific columns later)
-- ==============================================================================

-- Note: We're NOT dropping columns from users table yet to maintain backward compatibility.
-- These columns can be dropped in a future migration after the API is updated:
--   - level (moved to user_bots)
--   - reply_mode (moved to user_bots)
--   - tts_voice (moved to user_bots)
--   - onboarding_state (moved to user_bots)
--   - bot_key (deprecated: now many-to-many via user_bots)
--   - target_lang (deprecated: learning language is now encoded in bot_key, e.g., 'uk-en' = English)
--   - summary (already moved to user_summaries table per bot)


-- migrate:down
-- Forward-only migrations; no down migration.
SELECT 1;
