-- migrate:up

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS onboarding_complete_prompt_sent_at,
  DROP COLUMN IF EXISTS onboarding_completed_at;

-- migrate:down

ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS onboarding_complete_prompt_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;
