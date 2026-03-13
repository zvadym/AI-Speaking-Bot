-- migrate:up

ALTER TABLE public.bot_topic_catalog
  ADD COLUMN topic_mode text NOT NULL DEFAULT 'open_chat',
  ADD COLUMN speech_acts_base jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN lexical_anchors_target jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN grammar_targets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN starter_questions_by_level_target jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN recovery_questions_by_level_target jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN bridge_patterns_target jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN hard_block_base jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN soft_redirect_base jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN opening_prompt_target text NOT NULL DEFAULT '';

ALTER TABLE public.bot_topic_catalog
  ADD CONSTRAINT bot_topic_catalog_topic_mode_check
  CHECK (topic_mode = ANY (ARRAY['open_chat'::text, 'roleplay'::text, 'rehearsal'::text]));

UPDATE public.bot_topic_catalog
SET topic_mode = CASE
      WHEN topic_id IN ('coffee', 'apartment') THEN 'roleplay'
      WHEN topic_id IN ('interview', 'office') THEN 'rehearsal'
      ELSE 'open_chat'
    END,
    soft_redirect_base = COALESCE(avoid_base, '[]'::jsonb),
    hard_block_base = COALESCE(hard_block_base, '[]'::jsonb),
    starter_questions_by_level_target = CASE
      WHEN starter_questions_by_level_target = '{}'::jsonb
        THEN jsonb_build_object('default', COALESCE(starter_questions_target, '[]'::jsonb))
      ELSE starter_questions_by_level_target
    END,
    recovery_questions_by_level_target = CASE
      WHEN recovery_questions_by_level_target = '{}'::jsonb
        THEN jsonb_build_object('default', COALESCE(recovery_questions_target, '[]'::jsonb))
      ELSE recovery_questions_by_level_target
    END,
    opening_prompt_target = CASE
      WHEN BTRIM(opening_prompt_target) <> '' THEN opening_prompt_target
      ELSE COALESCE(starter_questions_target->>0, '')
    END;

-- migrate:down

ALTER TABLE public.bot_topic_catalog
  DROP CONSTRAINT IF EXISTS bot_topic_catalog_topic_mode_check;

ALTER TABLE public.bot_topic_catalog
  DROP COLUMN IF EXISTS opening_prompt_target,
  DROP COLUMN IF EXISTS soft_redirect_base,
  DROP COLUMN IF EXISTS hard_block_base,
  DROP COLUMN IF EXISTS bridge_patterns_target,
  DROP COLUMN IF EXISTS recovery_questions_by_level_target,
  DROP COLUMN IF EXISTS starter_questions_by_level_target,
  DROP COLUMN IF EXISTS grammar_targets_json,
  DROP COLUMN IF EXISTS lexical_anchors_target,
  DROP COLUMN IF EXISTS speech_acts_base,
  DROP COLUMN IF EXISTS topic_mode;
