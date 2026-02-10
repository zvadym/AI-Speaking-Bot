ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS text_voice_nudge_sent boolean NOT NULL DEFAULT false;
