-- migrate:up
ALTER TABLE user_bots
  ADD COLUMN IF NOT EXISTS onboarding_showcase_sent boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE user_bots
  DROP COLUMN IF EXISTS onboarding_showcase_sent;
