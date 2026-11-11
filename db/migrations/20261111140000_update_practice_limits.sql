-- migrate:up
UPDATE public.plans
SET voice_seconds_limit = 600,
    voice_limit_period = 'lifetime'
WHERE tier = 'free';

UPDATE public.plans
SET voice_seconds_limit = 7200,
    voice_limit_period = 'month'
WHERE tier = 'pro';

-- migrate:down
-- Limits are a product policy change; restore them with a new forward migration.
DO $$ BEGIN
  RAISE EXCEPTION 'Practice limits must be restored with a forward migration';
END $$;
