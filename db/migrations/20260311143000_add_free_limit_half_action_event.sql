-- migrate:up

ALTER TABLE public.action_events
  DROP CONSTRAINT IF EXISTS action_events_action_type_check;

ALTER TABLE public.action_events
  ADD CONSTRAINT action_events_action_type_check
  CHECK (
    action_type = ANY (
      ARRAY[
        'start'::text,
        'profile_set_level'::text,
        'first_voice_sent'::text,
        'first_answer_delivered'::text,
        'day1_return'::text,
        'topic_set'::text,
        'topic_message_sent'::text,
        'topic_clear'::text,
        'free_limit_half'::text,
        'paywall_shown'::text,
        'purchase_success'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.log_free_limit_half_from_usage_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  effective_tier text;
  limit_seconds integer;
  limit_period text;
  threshold_seconds integer;
  period_start timestamptz;
  period_key text;
  used_after integer;
  used_before integer;
BEGIN
  IF NEW.bot_key IS NULL OR BTRIM(NEW.bot_key) = '' THEN
    RETURN NEW;
  END IF;

  SELECT
    CASE
      WHEN u.override_plan_tier IS NOT NULL
        AND u.override_expires_at IS NOT NULL
        AND NOW() < u.override_expires_at
        THEN u.override_plan_tier
      WHEN u.plan_expires_at IS NOT NULL
        AND NOW() < u.plan_expires_at
        THEN u.plan_tier
      ELSE 'free'
    END
  INTO effective_tier
  FROM public.users u
  WHERE u.chat_id = NEW.chat_id
  LIMIT 1;

  IF COALESCE(BTRIM(effective_tier), 'free') <> 'free' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(p.voice_seconds_limit, 0)::int,
    COALESCE(NULLIF(BTRIM(p.voice_limit_period), ''), 'lifetime')
  INTO limit_seconds, limit_period
  FROM public.plans p
  WHERE p.tier = 'free'
  LIMIT 1;

  IF COALESCE(limit_seconds, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  threshold_seconds := CEIL(limit_seconds::numeric * 0.5)::int;
  IF threshold_seconds <= 0 THEN
    RETURN NEW;
  END IF;

  IF limit_period = 'month' THEN
    period_start := date_trunc('month', NEW.occurred_at);
    period_key := to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM');
  ELSE
    period_start := NULL;
    period_key := 'lifetime';
  END IF;

  SELECT COALESCE(SUM(v.seconds), 0)::int
  INTO used_after
  FROM public.voice_usage_events v
  WHERE v.chat_id = NEW.chat_id
    AND v.bot_key = NEW.bot_key
    AND (
      limit_period <> 'month'
      OR (
        v.occurred_at >= period_start
        AND v.occurred_at < (period_start + INTERVAL '1 month')
      )
    );

  used_before := GREATEST(COALESCE(used_after, 0) - GREATEST(COALESCE(NEW.seconds, 0), 0), 0);

  IF used_before >= threshold_seconds OR COALESCE(used_after, 0) < threshold_seconds THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.action_events (
    chat_id,
    bot_key,
    action_type,
    source,
    idempotency_key,
    properties,
    occurred_at
  )
  VALUES (
    NEW.chat_id,
    NEW.bot_key,
    'free_limit_half',
    'db_trigger',
    'free_limit_half:' || NEW.chat_id::text || ':' || COALESCE(NEW.bot_key, '') || ':' || period_key,
    jsonb_build_object(
      'limit_seconds', limit_seconds,
      'threshold_seconds', threshold_seconds,
      'used_seconds', used_after,
      'limit_period', limit_period,
      'period_key', period_key,
      'direction', NEW.direction,
      'source', NEW.source,
      'event_seconds', NEW.seconds
    ),
    NEW.occurred_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_free_limit_half ON public.voice_usage_events;
CREATE TRIGGER trg_action_free_limit_half
AFTER INSERT ON public.voice_usage_events
FOR EACH ROW
EXECUTE FUNCTION public.log_free_limit_half_from_usage_event();

-- migrate:down

DROP TRIGGER IF EXISTS trg_action_free_limit_half ON public.voice_usage_events;
DROP FUNCTION IF EXISTS public.log_free_limit_half_from_usage_event();

ALTER TABLE public.action_events
  DROP CONSTRAINT IF EXISTS action_events_action_type_check;

ALTER TABLE public.action_events
  ADD CONSTRAINT action_events_action_type_check
  CHECK (
    action_type = ANY (
      ARRAY[
        'start'::text,
        'profile_set_level'::text,
        'first_voice_sent'::text,
        'first_answer_delivered'::text,
        'day1_return'::text,
        'topic_set'::text,
        'topic_message_sent'::text,
        'topic_clear'::text,
        'paywall_shown'::text,
        'purchase_success'::text
      ]
    )
  );
