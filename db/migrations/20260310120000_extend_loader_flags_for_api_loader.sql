-- migrate:up
ALTER TABLE public.loader_flags
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS message_id bigint,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT NOW();

UPDATE public.loader_flags
SET started_at = COALESCE(started_at, updated_at, NOW())
WHERE started_at IS NULL;

-- migrate:down
ALTER TABLE public.loader_flags
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS message_id,
  DROP COLUMN IF EXISTS session_id;
