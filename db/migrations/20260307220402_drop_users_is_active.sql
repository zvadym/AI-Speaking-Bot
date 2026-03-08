-- migrate:up

DROP INDEX IF EXISTS idx_users_is_active;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS is_active;

-- migrate:down

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.users u
SET is_active = EXISTS (
  SELECT 1
  FROM public.user_bots ub
  WHERE ub.chat_id = u.chat_id
    AND COALESCE(ub.is_active, true) = true
);

CREATE INDEX IF NOT EXISTS idx_users_is_active
  ON public.users (is_active);
