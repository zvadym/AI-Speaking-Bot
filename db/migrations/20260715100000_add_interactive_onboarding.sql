-- migrate:up

CREATE TABLE public.bot_onboarding_sessions (
  chat_id bigint NOT NULL,
  bot_key text NOT NULL,
  version integer NOT NULL DEFAULT 2,
  state text NOT NULL DEFAULT 'choose_scenario',
  scenario text,
  first_input_mode text,
  suggested_level text,
  completion_decision_id text,
  started_at timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at timestamp with time zone NOT NULL DEFAULT NOW(),
  completed_at timestamp with time zone,
  PRIMARY KEY (chat_id, bot_key),
  CONSTRAINT bot_onboarding_sessions_user_bot_fkey
    FOREIGN KEY (chat_id, bot_key)
    REFERENCES public.user_bots(chat_id, bot_key)
    ON DELETE CASCADE,
  CONSTRAINT bot_onboarding_sessions_version_check CHECK (version > 0),
  CONSTRAINT bot_onboarding_sessions_state_check CHECK (
    state = ANY (ARRAY['choose_scenario'::text, 'await_practice'::text, 'completed'::text])
  ),
  CONSTRAINT bot_onboarding_sessions_scenario_check CHECK (
    scenario IS NULL OR scenario = ANY (
      ARRAY['about_self'::text, 'daily_life'::text, 'travel'::text, 'freeform'::text]
    )
  ),
  CONSTRAINT bot_onboarding_sessions_input_mode_check CHECK (
    first_input_mode IS NULL OR first_input_mode = ANY (ARRAY['voice'::text, 'text'::text])
  ),
  CONSTRAINT bot_onboarding_sessions_level_check CHECK (
    suggested_level IS NULL OR suggested_level = ANY (
      ARRAY['a1'::text, 'a2'::text, 'b1'::text, 'b2'::text, 'c1'::text]
    )
  ),
  CONSTRAINT bot_onboarding_sessions_decision_check CHECK (
    completion_decision_id IS NULL OR length(completion_decision_id) <= 200
  ),
  CONSTRAINT bot_onboarding_sessions_completion_check CHECK (
    (state = 'completed' AND completed_at IS NOT NULL)
    OR (state <> 'completed' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_bot_onboarding_sessions_state_updated
  ON public.bot_onboarding_sessions (state, updated_at);

CREATE VIEW public.bot_onboarding_completion AS
SELECT
  ub.chat_id,
  ub.bot_key,
  COALESCE(session.completed_at, legacy.sent_at) AS completed_at,
  CASE
    WHEN session.completed_at IS NOT NULL THEN 'interactive_v2'::text
    ELSE 'legacy_message'::text
  END AS source
FROM public.user_bots ub
LEFT JOIN public.bot_onboarding_sessions session
  ON session.chat_id = ub.chat_id
 AND session.bot_key = ub.bot_key
 AND session.state = 'completed'
LEFT JOIN LATERAL (
  SELECT MIN(std.sent_at) AS sent_at
  FROM public.scheduled_task_dispatches std
  WHERE std.chat_id = ub.chat_id
    AND std.bot_key = ub.bot_key
    AND std.task_type = 'onboarding_complete'
    AND std.schedule_key = 'once'
    AND std.status = 'sent'
    AND std.sent_at IS NOT NULL
) legacy ON true
WHERE COALESCE(session.completed_at, legacy.sent_at) IS NOT NULL;

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
        'purchase_success'::text,
        'reply_kbd_topic_click'::text,
        'reply_kbd_level_click'::text,
        'reply_kbd_voice_click'::text,
        'reply_kbd_xp_click'::text,
        'idiom_phrase_more_click'::text,
        'onboarding_scenario_selected'::text,
        'onboarding_practice_sent'::text,
        'onboarding_completed'::text,
        'onboarding_level_confirmed'::text,
        'onboarding_bonus_selected'::text
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
        'day1_return'::text,
        'topic_set'::text,
        'topic_message_sent'::text,
        'topic_clear'::text,
        'free_limit_half'::text,
        'paywall_shown'::text,
        'purchase_success'::text,
        'reply_kbd_topic_click'::text,
        'reply_kbd_level_click'::text,
        'reply_kbd_voice_click'::text,
        'reply_kbd_xp_click'::text,
        'idiom_phrase_more_click'::text
      ]
    )
  );

DROP VIEW IF EXISTS public.bot_onboarding_completion;
DROP TABLE IF EXISTS public.bot_onboarding_sessions;
