-- migrate:up

ALTER TABLE public.broadcast_campaigns
  ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_file_id text;

ALTER TABLE public.broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_message_kind_check;

ALTER TABLE public.broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_message_kind_check CHECK (
    message_kind IN ('text', 'photo', 'video')
  );

ALTER TABLE public.broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_media_presence_check;

ALTER TABLE public.broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_media_presence_check CHECK (
    (
      message_kind = 'text'
      AND media_url IS NULL
      AND media_file_id IS NULL
    )
    OR (
      message_kind IN ('photo', 'video')
      AND (media_url IS NOT NULL OR media_file_id IS NOT NULL)
    )
  );

-- migrate:down
SELECT 1;

