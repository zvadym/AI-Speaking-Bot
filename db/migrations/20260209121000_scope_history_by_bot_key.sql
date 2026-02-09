-- migrate:up

-- Per-bot chat history and summaries while keeping billing/limits global per chat_id.
-- bot_key convention: "<base_language>-<learning_language>" (example: "uk-de").

-- 1) Messages: add bot_key so history is separated per bot.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS bot_key text;

-- Backfill bot_key from existing user preference where possible (legacy: target_lang in users).
UPDATE public.messages m
SET bot_key = CASE
  WHEN u.target_lang = 'en' THEN 'uk-en'
  WHEN u.target_lang = 'de' THEN 'uk-de'
  ELSE 'uk-de'
END
FROM public.users u
WHERE m.bot_key IS NULL
  AND u.chat_id = m.chat_id;

-- Fallback for any rows without a matching user row.
UPDATE public.messages
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN bot_key SET NOT NULL;

ALTER TABLE public.messages
  ALTER COLUMN bot_key SET DEFAULT 'uk-de';

CREATE INDEX IF NOT EXISTS idx_messages_chat_bot_id
  ON public.messages (chat_id, bot_key, id DESC);


-- 2) Summaries: move summary into a per-bot table.
CREATE TABLE IF NOT EXISTS public.user_summaries (
  chat_id bigint NOT NULL,
  bot_key text NOT NULL,
  summary text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_summaries_pkey PRIMARY KEY (chat_id, bot_key),
  CONSTRAINT user_summaries_user_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE
);

-- Backfill per-bot summaries from legacy users.summary.
INSERT INTO public.user_summaries (chat_id, bot_key, summary, updated_at)
SELECT
  u.chat_id,
  CASE
    WHEN u.target_lang = 'en' THEN 'uk-en'
    WHEN u.target_lang = 'de' THEN 'uk-de'
    ELSE 'uk-de'
  END AS bot_key,
  COALESCE(u.summary, '') AS summary,
  COALESCE(u.updated_at, now()) AS updated_at
FROM public.users u
ON CONFLICT (chat_id, bot_key) DO NOTHING;


-- 3) Loader flags: scope by bot_key to avoid cross-bot interference.
ALTER TABLE public.loader_flags
  ADD COLUMN IF NOT EXISTS bot_key text;

UPDATE public.loader_flags lf
SET bot_key = CASE
  WHEN u.target_lang = 'en' THEN 'uk-en'
  WHEN u.target_lang = 'de' THEN 'uk-de'
  ELSE 'uk-de'
END
FROM public.users u
WHERE lf.bot_key IS NULL
  AND u.chat_id = lf.chat_id;

UPDATE public.loader_flags
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.loader_flags
  ALTER COLUMN bot_key SET NOT NULL;

ALTER TABLE public.loader_flags
  DROP CONSTRAINT IF EXISTS loader_flags_pkey;

ALTER TABLE public.loader_flags
  ADD CONSTRAINT loader_flags_pkey PRIMARY KEY (chat_id, bot_key);


-- 4) Pending feedback: scope by bot_key so /feedback doesn't conflict across bots.
ALTER TABLE public.pending_feedback
  ADD COLUMN IF NOT EXISTS bot_key text;

UPDATE public.pending_feedback pf
SET bot_key = CASE
  WHEN u.target_lang = 'en' THEN 'uk-en'
  WHEN u.target_lang = 'de' THEN 'uk-de'
  ELSE 'uk-de'
END
FROM public.users u
WHERE pf.bot_key IS NULL
  AND u.chat_id = pf.chat_id;

UPDATE public.pending_feedback
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.pending_feedback
  ALTER COLUMN bot_key SET NOT NULL;

ALTER TABLE public.pending_feedback
  DROP CONSTRAINT IF EXISTS pending_feedback_pkey;

ALTER TABLE public.pending_feedback
  ADD CONSTRAINT pending_feedback_pkey PRIMARY KEY (chat_id, bot_key);


-- 5) Feedback: keep global, but store bot_key for audit/debug.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS bot_key text;

UPDATE public.feedback f
SET bot_key = CASE
  WHEN u.target_lang = 'en' THEN 'uk-en'
  WHEN u.target_lang = 'de' THEN 'uk-de'
  ELSE 'uk-de'
END
FROM public.users u
WHERE f.bot_key IS NULL
  AND u.chat_id = f.chat_id;

UPDATE public.feedback
SET bot_key = 'uk-de'
WHERE bot_key IS NULL;

ALTER TABLE public.feedback
  ALTER COLUMN bot_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_chat_bot_id
  ON public.feedback (chat_id, bot_key, id DESC);


-- migrate:down
-- Forward-only migrations; no down migration.
SELECT 1;

