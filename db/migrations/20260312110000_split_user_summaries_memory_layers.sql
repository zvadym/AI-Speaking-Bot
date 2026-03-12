-- migrate:up

ALTER TABLE public.user_summaries
  ADD COLUMN IF NOT EXISTS profile_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS short_summary text NOT NULL DEFAULT '';

UPDATE public.user_summaries
SET
  profile_summary = COALESCE(summary, ''),
  short_summary = ''
WHERE profile_summary = ''
  AND short_summary = '';

-- migrate:down

ALTER TABLE public.user_summaries
  DROP COLUMN IF EXISTS short_summary,
  DROP COLUMN IF EXISTS profile_summary;
