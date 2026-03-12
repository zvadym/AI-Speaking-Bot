-- migrate:up

CREATE TABLE public.bot_topic_catalog (
  id bigserial PRIMARY KEY,
  bot_key text NOT NULL,
  topic_id text NOT NULL,
  emoji text NOT NULL DEFAULT '🧩',
  title_base text NOT NULL,
  goal_base text NOT NULL,
  allowed_base jsonb NOT NULL DEFAULT '[]'::jsonb,
  avoid_base jsonb NOT NULL DEFAULT '[]'::jsonb,
  starter_questions_target jsonb NOT NULL DEFAULT '[]'::jsonb,
  recovery_questions_target jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_topic_catalog_topic_unique UNIQUE (bot_key, topic_id)
);

CREATE INDEX idx_bot_topic_catalog_bot_sort
  ON public.bot_topic_catalog (bot_key, sort_order, topic_id);

-- migrate:down

DROP TABLE IF EXISTS public.bot_topic_catalog;
