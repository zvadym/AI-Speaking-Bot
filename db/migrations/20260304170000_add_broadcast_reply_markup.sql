-- migrate:up

ALTER TABLE public.broadcast_campaigns
  ADD COLUMN IF NOT EXISTS reply_markup jsonb;

-- migrate:down
SELECT 1;
