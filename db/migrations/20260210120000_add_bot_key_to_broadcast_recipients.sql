-- migrate:up

ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS bot_key text;

-- Backfill existing rows:
-- 1) Prefer explicit campaign bot filter if present,
-- 2) otherwise pick an active user_bots entry,
-- 3) then fallback to users.bot_key,
-- 4) then a safe default.
UPDATE public.broadcast_recipients r
SET bot_key = LEFT(
  LOWER(
    COALESCE(
      NULLIF(c.filters -> 'bots' ->> 0, ''),
      (
        SELECT b.bot_key
        FROM public.user_bots b
        WHERE b.chat_id = r.chat_id
          AND COALESCE(b.is_active, true) = true
        ORDER BY b.bot_key ASC
        LIMIT 1
      ),
      (
        SELECT NULLIF(u.bot_key, '')
        FROM public.users u
        WHERE u.chat_id = r.chat_id
        LIMIT 1
      ),
      'uk-de'
    )
  ),
  32
)
FROM public.broadcast_campaigns c
WHERE r.campaign_id = c.id
  AND (r.bot_key IS NULL OR BTRIM(r.bot_key) = '');

ALTER TABLE public.broadcast_recipients
  ALTER COLUMN bot_key SET NOT NULL;

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_pkey;

ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (campaign_id, chat_id, bot_key);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign_chat_bot
  ON public.broadcast_recipients (campaign_id, chat_id, bot_key);

-- migrate:down
SELECT 1;
