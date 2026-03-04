-- migrate:up

ALTER TABLE public.messages
  ADD COLUMN topic_template_id text;

CREATE INDEX idx_messages_chat_bot_topic_id_desc
  ON public.messages (chat_id, bot_key, topic_template_id, id DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_messages_chat_bot_topic_id_desc;

ALTER TABLE public.messages
  DROP COLUMN IF EXISTS topic_template_id;

