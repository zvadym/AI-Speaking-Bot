-- migrate:up

CREATE OR REPLACE FUNCTION public.log_first_voice_sent_from_usage_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.direction <> 'in' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.action_events (
    chat_id,
    bot_key,
    action_type,
    source,
    idempotency_key,
    occurred_at
  )
  VALUES (
    NEW.chat_id,
    NEW.bot_key,
    'first_voice_sent',
    'db_trigger_voice',
    'first_voice_sent:' || NEW.chat_id::text || ':' || COALESCE(NEW.bot_key, ''),
    NEW.occurred_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_first_voice_sent_from_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role <> 'user' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.action_events (
    chat_id,
    bot_key,
    action_type,
    source,
    idempotency_key,
    occurred_at
  )
  VALUES (
    NEW.chat_id,
    NEW.bot_key,
    'first_voice_sent',
    'db_trigger_message',
    'first_voice_sent:' || NEW.chat_id::text || ':' || COALESCE(NEW.bot_key, ''),
    NEW.created_at
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET occurred_at = LEAST(public.action_events.occurred_at, EXCLUDED.occurred_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_first_voice_sent_from_message ON public.messages;
CREATE TRIGGER trg_action_first_voice_sent_from_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.log_first_voice_sent_from_message();

INSERT INTO public.action_events (
  chat_id,
  bot_key,
  action_type,
  source,
  idempotency_key,
  occurred_at
)
SELECT
  x.chat_id,
  x.bot_key,
  'first_voice_sent',
  'backfill',
  'first_voice_sent:' || x.chat_id::text || ':' || COALESCE(x.bot_key, ''),
  x.first_occurred_at
FROM (
  SELECT
    input.chat_id,
    input.bot_key,
    MIN(input.occurred_at) AS first_occurred_at
  FROM (
    SELECT
      v.chat_id,
      v.bot_key,
      v.occurred_at
    FROM public.voice_usage_events v
    WHERE v.direction = 'in'

    UNION ALL

    SELECT
      m.chat_id,
      m.bot_key,
      m.created_at AS occurred_at
    FROM public.messages m
    WHERE m.role = 'user'
  ) AS input
  GROUP BY input.chat_id, input.bot_key
) AS x
ON CONFLICT (idempotency_key) DO UPDATE
  SET occurred_at = LEAST(public.action_events.occurred_at, EXCLUDED.occurred_at);

-- migrate:down

DROP TRIGGER IF EXISTS trg_action_first_voice_sent_from_message ON public.messages;
DROP FUNCTION IF EXISTS public.log_first_voice_sent_from_message();
