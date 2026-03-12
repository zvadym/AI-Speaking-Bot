-- migrate:up

ALTER TABLE public.bot_topic_catalog
  ADD COLUMN access_tier text NOT NULL DEFAULT 'all';

ALTER TABLE public.bot_topic_catalog
  ADD CONSTRAINT bot_topic_catalog_access_tier_check
  CHECK (access_tier = ANY (ARRAY['all'::text, 'free'::text, 'pro'::text]));

-- migrate:down

ALTER TABLE public.bot_topic_catalog
  DROP CONSTRAINT IF EXISTS bot_topic_catalog_access_tier_check;

ALTER TABLE public.bot_topic_catalog
  DROP COLUMN IF EXISTS access_tier;
