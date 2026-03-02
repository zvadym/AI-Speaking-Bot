-- migrate:up
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS voice_seconds_limit integer,
  ADD COLUMN IF NOT EXISTS voice_limit_period text;

UPDATE public.plans
SET
  voice_seconds_limit = CASE tier
    WHEN 'free' THEN 240
    WHEN 'plus' THEN 7200
    WHEN 'pro' THEN 72000
    ELSE COALESCE(voice_seconds_limit, 0)
  END,
  voice_limit_period = CASE tier
    WHEN 'free' THEN 'lifetime'
    WHEN 'plus' THEN 'month'
    WHEN 'pro' THEN 'month'
    ELSE COALESCE(voice_limit_period, 'lifetime')
  END,
  user_audio_seconds_per_week = CASE tier
    WHEN 'free' THEN 120
    WHEN 'plus' THEN 3600
    WHEN 'pro' THEN 36000
    ELSE user_audio_seconds_per_week
  END,
  tts_seconds_per_week = CASE tier
    WHEN 'free' THEN 120
    WHEN 'plus' THEN 3600
    WHEN 'pro' THEN 36000
    ELSE tts_seconds_per_week
  END;

ALTER TABLE public.plans
  ALTER COLUMN voice_seconds_limit SET NOT NULL,
  ALTER COLUMN voice_limit_period SET NOT NULL;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_voice_limit_period_check;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_voice_limit_period_check
  CHECK (voice_limit_period IN ('lifetime', 'month'));

-- migrate:down
ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_voice_limit_period_check;

ALTER TABLE public.plans
  DROP COLUMN IF EXISTS voice_limit_period,
  DROP COLUMN IF EXISTS voice_seconds_limit;
