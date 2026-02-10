-- migrate:up
ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS text_voice_nudge_sent boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS text_voice_nudge_sent;
