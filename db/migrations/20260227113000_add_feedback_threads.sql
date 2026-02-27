-- migrate:up

CREATE TABLE IF NOT EXISTS public.feedback_threads (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    archived_at timestamp with time zone,
    archived_by text,
    PRIMARY KEY (chat_id, bot_key)
);

CREATE INDEX IF NOT EXISTS idx_feedback_threads_archived_at
    ON public.feedback_threads (archived_at);

-- migrate:down

DROP INDEX IF EXISTS idx_feedback_threads_archived_at;
DROP TABLE IF EXISTS public.feedback_threads;
