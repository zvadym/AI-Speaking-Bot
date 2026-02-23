-- migrate:up

-- Add a 3-day activity metric to bot_stats for more granular "recently active" reporting.
-- This keeps naming consistent with existing users_last_7_days/users_last_30_days columns.

CREATE OR REPLACE VIEW public.bot_stats AS
SELECT
  ub.bot_key,
  COUNT(DISTINCT ub.chat_id) AS total_users,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.is_active) AS active_users,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.last_seen_at >= NOW() - INTERVAL '7 days') AS users_last_7_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.last_seen_at >= NOW() - INTERVAL '30 days') AS users_last_30_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.created_at >= NOW() - INTERVAL '7 days') AS new_users_7_days,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.created_at >= NOW() - INTERVAL '30 days') AS new_users_30_days,
  MIN(ub.first_seen_at) AS first_user_at,
  MAX(ub.last_seen_at) AS last_activity_at,
  COUNT(DISTINCT ub.chat_id) FILTER (WHERE ub.last_seen_at >= NOW() - INTERVAL '3 days') AS users_last_3_days
FROM public.user_bots ub
GROUP BY ub.bot_key;

COMMENT ON VIEW public.bot_stats IS 'Real-time statistics per bot: user counts, activity, and growth metrics';

-- migrate:down
-- Forward-only migrations; no down migration.
SELECT 1;
