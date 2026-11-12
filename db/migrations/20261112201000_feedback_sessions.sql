-- migrate:up
-- The old command-based requests cannot be bound to an actual prompt. Feedback
-- history lives in feedback and is preserved; only transient requests expire.
DELETE FROM public.pending_feedback;
ALTER TABLE public.pending_feedback
  DROP CONSTRAINT pending_feedback_pkey,
  ADD COLUMN session_id text NOT NULL,
  ADD COLUMN prompt_message_id bigint,
  ADD COLUMN card_message_id bigint NOT NULL,
  ADD COLUMN status text DEFAULT 'awaiting' NOT NULL,
  ADD COLUMN completed_feedback_id bigint REFERENCES public.feedback(id),
  ADD CONSTRAINT pending_feedback_pkey PRIMARY KEY (session_id),
  ADD CONSTRAINT pending_feedback_status_check CHECK (status IN ('awaiting','completed','cancelled')),
  ADD CONSTRAINT pending_feedback_prompt_check CHECK (prompt_message_id IS NULL OR prompt_message_id > 0),
  ADD CONSTRAINT pending_feedback_card_check CHECK (card_message_id > 0);
CREATE UNIQUE INDEX pending_feedback_active_scope ON public.pending_feedback(chat_id,bot_key) WHERE status = 'awaiting';
CREATE UNIQUE INDEX pending_feedback_prompt_scope ON public.pending_feedback(chat_id,bot_key,prompt_message_id) WHERE prompt_message_id IS NOT NULL;

-- migrate:down
DO $$ BEGIN
  RAISE EXCEPTION 'Feedback sessions require a forward migration';
END $$;
