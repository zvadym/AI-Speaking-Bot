-- migrate:up

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS onboarding_showcase_sent;

ALTER TABLE public.voice_usage_events
  DROP COLUMN IF EXISTS message_id;

ALTER TABLE public.action_events
  DROP COLUMN IF EXISTS created_at;

ALTER TABLE public.plans
  DROP COLUMN IF EXISTS user_audio_seconds_per_week,
  DROP COLUMN IF EXISTS tts_seconds_per_week;

DROP TABLE IF EXISTS public.usage_week;

-- migrate:down
SELECT 1;
