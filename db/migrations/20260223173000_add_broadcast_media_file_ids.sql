-- migrate:up

ALTER TABLE public.broadcast_campaigns
  ADD COLUMN IF NOT EXISTS media_file_ids jsonb;

ALTER TABLE public.broadcast_campaigns
  DROP CONSTRAINT IF EXISTS broadcast_campaigns_media_presence_check;

ALTER TABLE public.broadcast_campaigns
  ADD CONSTRAINT broadcast_campaigns_media_presence_check CHECK (
    (
      message_kind = 'text'
      AND media_url IS NULL
      AND media_file_id IS NULL
      AND (media_file_ids IS NULL OR media_file_ids = '{}'::jsonb)
    )
    OR (
      message_kind IN ('photo', 'video')
      AND (
        media_url IS NOT NULL
        OR media_file_id IS NOT NULL
        OR (
          media_file_ids IS NOT NULL
          AND jsonb_typeof(media_file_ids) = 'object'
          AND media_file_ids <> '{}'::jsonb
        )
      )
    )
  );

-- migrate:down
SELECT 1;
