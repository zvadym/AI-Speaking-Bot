-- migrate:up

ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS onboarding_complete_prompt_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

DROP TRIGGER IF EXISTS trg_action_profile_set_level ON public.user_bots;

CREATE OR REPLACE FUNCTION public.log_profile_set_level_from_user_bot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.level IS DISTINCT FROM NEW.level THEN
    INSERT INTO public.action_events (
      chat_id,
      bot_key,
      action_type,
      source,
      idempotency_key,
      occurred_at,
      properties
    )
    VALUES (
      NEW.chat_id,
      NEW.bot_key,
      'profile_set_level',
      'db_trigger_user_bots',
      'profile_set_level:' || NEW.chat_id::text,
      COALESCE(NEW.updated_at, NOW()),
      jsonb_build_object(
        'level', NEW.level,
        'from_level', OLD.level
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_action_profile_set_level
AFTER UPDATE OF level ON public.user_bots
FOR EACH ROW
EXECUTE FUNCTION public.log_profile_set_level_from_user_bot();

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS onboarding_level_done,
  DROP COLUMN IF EXISTS onboarding_voice_done,
  DROP COLUMN IF EXISTS onboarding_state;

-- migrate:down

ALTER TABLE public.user_bots
  ADD COLUMN IF NOT EXISTS onboarding_state text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS onboarding_level_done boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS onboarding_voice_done boolean NOT NULL DEFAULT true;

DROP TRIGGER IF EXISTS trg_action_profile_set_level ON public.user_bots;

CREATE OR REPLACE FUNCTION public.log_profile_set_level_from_user_bot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF (OLD.level IS DISTINCT FROM NEW.level)
     OR (OLD.onboarding_state = 'await_level' AND NEW.onboarding_state = 'ready') THEN
    INSERT INTO public.action_events (
      chat_id,
      bot_key,
      action_type,
      source,
      idempotency_key,
      occurred_at,
      properties
    )
    VALUES (
      NEW.chat_id,
      NEW.bot_key,
      'profile_set_level',
      'db_trigger_user_bots',
      'profile_set_level:' || NEW.chat_id::text,
      COALESCE(NEW.updated_at, NOW()),
      jsonb_build_object(
        'level', NEW.level,
        'from_level', OLD.level,
        'from_state', OLD.onboarding_state,
        'to_state', NEW.onboarding_state
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_action_profile_set_level
AFTER UPDATE OF level, onboarding_state ON public.user_bots
FOR EACH ROW
EXECUTE FUNCTION public.log_profile_set_level_from_user_bot();

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS onboarding_complete_prompt_sent_at,
  DROP COLUMN IF EXISTS onboarding_completed_at;
