-- migrate:up
ALTER TABLE public.feedback
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT feedback_idempotency_key_check CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 200),
  ADD CONSTRAINT feedback_idempotency_key_key UNIQUE (idempotency_key);

CREATE TABLE public.feedback_notifications (
  feedback_id bigint PRIMARY KEY REFERENCES public.feedback(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','sending','sent','unknown','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  lease_token uuid,
  lease_expires_at timestamptz,
  discord_message_id text,
  transcript_status text NOT NULL DEFAULT 'pending' CHECK (transcript_status IN ('pending','complete','unavailable','none')),
  last_error_code text,
  attachment_error_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  delivered_at timestamptz
);
CREATE INDEX idx_feedback_notifications_pending
  ON public.feedback_notifications(next_attempt_at,feedback_id) WHERE status='pending';

-- migrate:down
DO $$ BEGIN
  RAISE EXCEPTION 'Feedback notification state is durable; use a forward migration';
END $$;
