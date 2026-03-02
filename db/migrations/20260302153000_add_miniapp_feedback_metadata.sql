-- migrate:up

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'telegram';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feedback_category_check'
  ) THEN
    ALTER TABLE public.feedback
      ADD CONSTRAINT feedback_category_check
      CHECK (
        category IS NULL
        OR category = ANY (ARRAY['bug'::text, 'idea'::text, 'billing'::text, 'coach'::text])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feedback_source_check'
  ) THEN
    ALTER TABLE public.feedback
      ADD CONSTRAINT feedback_source_check
      CHECK (source = ANY (ARRAY['telegram'::text, 'miniapp'::text]));
  END IF;
END $$;

ALTER TABLE public.feedback_threads
  ADD COLUMN IF NOT EXISTS user_last_read_at timestamp with time zone;

-- migrate:down
-- Forward-only migrations; no down migration.
SELECT 1;
