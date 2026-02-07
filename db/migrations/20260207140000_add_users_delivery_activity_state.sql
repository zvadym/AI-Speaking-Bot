-- migrate:up

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactive_reason text,
  ADD COLUMN IF NOT EXISTS inactive_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivery_error text;

UPDATE public.users
SET is_active = true
WHERE is_active IS NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_inactive_reason_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_inactive_reason_check CHECK (
    inactive_reason IS NULL
    OR inactive_reason IN ('blocked', 'deactivated', 'chat_not_found', 'forbidden')
  );

CREATE INDEX IF NOT EXISTS idx_users_is_active
  ON public.users (is_active);

CREATE INDEX IF NOT EXISTS idx_users_inactive_at
  ON public.users (inactive_at)
  WHERE inactive_at IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_users_inactive_at;
DROP INDEX IF EXISTS idx_users_is_active;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_inactive_reason_check;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS last_delivery_error,
  DROP COLUMN IF EXISTS inactive_at,
  DROP COLUMN IF EXISTS inactive_reason,
  DROP COLUMN IF EXISTS is_active;
