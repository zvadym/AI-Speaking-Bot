-- migrate:up
CREATE TABLE public.bot_message_presentations (
  message_id bigint PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  telegram_message_id bigint NOT NULL CHECK (telegram_message_id > 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  pending_audio bytea,
  content_dirty boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
-- Forward-only: retain presentation state needed to preserve existing voice notes.
SELECT 1;
