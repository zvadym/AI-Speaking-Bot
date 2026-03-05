-- migrate:up

ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS onboarding_level_done boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS onboarding_voice_done boolean NOT NULL DEFAULT true;

-- migrate:down

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS onboarding_voice_done,
  DROP COLUMN IF EXISTS onboarding_level_done;
