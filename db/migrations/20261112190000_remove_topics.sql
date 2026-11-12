-- migrate:up
-- Deploy with the previous API and worker stopped: they still read these columns.
DELETE FROM public.action_events
WHERE action_type IN ('topic_set', 'topic_message_sent', 'topic_clear', 'reply_kbd_topic_click');

ALTER TABLE public.action_events
  DROP CONSTRAINT action_events_action_type_check,
  ADD CONSTRAINT action_events_action_type_check CHECK (
    action_type = ANY (ARRAY[
      'start'::text,
      'profile_set_level'::text,
      'first_voice_sent'::text,
      'first_answer_delivered'::text,
      'day1_return'::text,
      'free_limit_half'::text,
      'paywall_shown'::text,
      'purchase_success'::text,
      'reply_kbd_level_click'::text,
      'reply_kbd_voice_click'::text,
      'reply_kbd_xp_click'::text,
      'idiom_phrase_more_click'::text,
      'onboarding_scenario_selected'::text,
      'onboarding_practice_sent'::text,
      'onboarding_completed'::text,
      'onboarding_level_confirmed'::text,
      'onboarding_bonus_selected'::text
    ])
  );

DROP TABLE public.bot_topic_catalog;

ALTER TABLE public.user_bots
  DROP COLUMN topic_enabled,
  DROP COLUMN topic_template_id,
  DROP COLUMN topic_pinned_message_id,
  DROP COLUMN topic_pack_json,
  DROP COLUMN topic_updated_at;

-- PostgreSQL also removes the index that depends on this column. Message rows,
-- support caches and the chat/bot history indexes are preserved.
ALTER TABLE public.messages DROP COLUMN topic_template_id;

-- migrate:down
DO $$ BEGIN
  RAISE EXCEPTION 'Removed topics and their data can only be restored with a forward migration';
END $$;
