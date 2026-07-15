-- migrate:up

ALTER TABLE public.bot_onboarding_sessions
  ADD COLUMN last_start_update_id bigint;

CREATE OR REPLACE VIEW public.bot_onboarding_completion AS
SELECT
  ub.chat_id,
  ub.bot_key,
  CASE
    WHEN session.chat_id IS NOT NULL THEN session.completed_at
    ELSE legacy.sent_at
  END AS completed_at,
  CASE
    WHEN session.chat_id IS NOT NULL THEN 'interactive_v2'::text
    ELSE 'legacy_message'::text
  END AS source
FROM public.user_bots ub
LEFT JOIN public.bot_onboarding_sessions session
  ON session.chat_id = ub.chat_id
 AND session.bot_key = ub.bot_key
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
WHERE CASE
  WHEN session.chat_id IS NOT NULL THEN session.completed_at
  ELSE legacy.sent_at
END IS NOT NULL;

-- migrate:down

CREATE OR REPLACE VIEW public.bot_onboarding_completion AS
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

ALTER TABLE public.bot_onboarding_sessions
  DROP COLUMN last_start_update_id;
