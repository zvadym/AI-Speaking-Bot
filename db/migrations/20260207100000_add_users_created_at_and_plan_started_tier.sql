-- migrate:up

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE public.users u
SET created_at = COALESCE(
  u.created_at,
  u.acquisition_start_at,
  (
    SELECT MIN(v.occurred_at)
    FROM public.voice_usage_events v
    WHERE v.chat_id = u.chat_id
  ),
  u.updated_at,
  NOW()
);

ALTER TABLE public.users
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.users
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON public.users (created_at);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan_started_tier text;

UPDATE public.users u
SET plan_started_tier = COALESCE(
  u.plan_started_tier,
  (
    SELECT p.tier
    FROM public.payments p
    WHERE p.chat_id = u.chat_id
      AND p.tier IN ('plus', 'pro')
    ORDER BY p.created_at ASC
    LIMIT 1
  ),
  CASE
    WHEN u.plan_started_at IS NOT NULL AND u.plan_tier IN ('plus', 'pro') THEN u.plan_tier
    ELSE NULL
  END
)
WHERE u.plan_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_plan_started_at
  ON public.users (plan_started_at)
  WHERE plan_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_plan_started_tier
  ON public.users (plan_started_tier)
  WHERE plan_started_tier IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_users_plan_started_tier;
DROP INDEX IF EXISTS idx_users_plan_started_at;
DROP INDEX IF EXISTS idx_users_created_at;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS plan_started_tier;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS created_at;
