-- migrate:up

ALTER TABLE public.users
  ADD COLUMN acquisition_start_payload text,
  ADD COLUMN acquisition_start_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_users_acquisition_start_payload
  ON public.users (acquisition_start_payload);

-- migrate:down
DROP INDEX IF EXISTS idx_users_acquisition_start_payload;

ALTER TABLE public.users
  DROP COLUMN acquisition_start_payload,
  DROP COLUMN acquisition_start_at;
