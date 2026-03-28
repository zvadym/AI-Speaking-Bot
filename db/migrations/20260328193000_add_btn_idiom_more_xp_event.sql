-- migrate:up

ALTER TABLE public.xp_events
  DROP CONSTRAINT IF EXISTS xp_events_event_type_check;

ALTER TABLE public.xp_events
  ADD CONSTRAINT xp_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'voice'::text,
        'text'::text,
        'btn_translation'::text,
        'btn_vocab'::text,
        'btn_hints'::text,
        'btn_idiom_more'::text,
        'starter'::text
      ]
    )
  );

-- migrate:down

ALTER TABLE public.xp_events
  DROP CONSTRAINT IF EXISTS xp_events_event_type_check;

ALTER TABLE public.xp_events
  ADD CONSTRAINT xp_events_event_type_check
  CHECK (
    event_type = ANY (
      ARRAY[
        'voice'::text,
        'text'::text,
        'btn_translation'::text,
        'btn_vocab'::text,
        'btn_hints'::text,
        'starter'::text
      ]
    )
  );
