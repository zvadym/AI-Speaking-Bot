-- migrate:up

ALTER TABLE public.user_summaries
  DROP COLUMN IF EXISTS summary;

-- migrate:down

ALTER TABLE public.user_summaries
  ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';

UPDATE public.user_summaries
SET summary = COALESCE(profile_summary, '')
WHERE summary = '';
