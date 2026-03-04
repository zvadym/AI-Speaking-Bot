-- migrate:up

ALTER TABLE public.user_bots
  ADD COLUMN topic_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN topic_template_id text,
  ADD COLUMN topic_pinned_message_id bigint,
  ADD COLUMN topic_pack_json jsonb,
  ADD COLUMN topic_updated_at timestamptz;

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
        'day1_return'::text
      ]
    )
  );

ALTER TABLE public.user_bots
  DROP COLUMN IF EXISTS topic_updated_at,
  DROP COLUMN IF EXISTS topic_pack_json,
  DROP COLUMN IF EXISTS topic_pinned_message_id,
  DROP COLUMN IF EXISTS topic_template_id,
  DROP COLUMN IF EXISTS topic_enabled;
