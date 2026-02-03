-- migrate:up
INSERT INTO public.plans (tier, user_audio_seconds_per_week, tts_seconds_per_week)
VALUES
  ('free', 180, 120),
  ('plus', 3600, 3600),
  ('pro', 36000, 36000)
ON CONFLICT (tier) DO UPDATE
SET
  user_audio_seconds_per_week = EXCLUDED.user_audio_seconds_per_week,
  tts_seconds_per_week = EXCLUDED.tts_seconds_per_week;

-- migrate:down
DELETE FROM public.plans
WHERE tier IN ('free', 'plus', 'pro');
