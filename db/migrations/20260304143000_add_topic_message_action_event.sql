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
        'paywall_shown'::text,
        'purchase_success'::text,
        'day1_return'::text,
        'topic_set'::text,
        'topic_message_sent'::text,
        'topic_clear'::text
      ]
    )
  );

-- migrate:down

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
        'paywall_shown'::text,
        'purchase_success'::text,
        'day1_return'::text,
        'topic_set'::text,
        'topic_clear'::text
      ]
    )
  );
