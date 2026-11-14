SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: grant_xp(bigint, text, text, integer, text, boolean, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grant_xp(p_chat_id bigint, p_bot_key text, p_event_type text, p_requested_xp integer, p_idempotency_key text, p_is_practice boolean DEFAULT false, p_occurred_at timestamp with time zone DEFAULT now(), p_meta jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(applied boolean, awarded_xp integer, xp_total integer, xp_daily integer, streak_current integer, streak_best integer, streak_last_day date, level integer, xp_into_level integer, xp_to_next integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_progress public.user_progress%ROWTYPE;
  v_event_day date;
  v_effective_daily integer;
  v_awarded_xp integer;
  v_inserted integer;
  v_new_streak integer;
  v_new_best integer;
  v_new_last_day date;
BEGIN
  IF p_chat_id IS NULL THEN
    RAISE EXCEPTION 'p_chat_id is required';
  END IF;

  IF COALESCE(trim(p_bot_key), '') = '' THEN
    RAISE EXCEPTION 'p_bot_key is required';
  END IF;

  IF COALESCE(trim(p_event_type), '') = '' THEN
    RAISE EXCEPTION 'p_event_type is required';
  END IF;

  IF COALESCE(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'p_idempotency_key is required';
  END IF;

  IF COALESCE(p_requested_xp, 0) < 0 THEN
    RAISE EXCEPTION 'p_requested_xp must be >= 0';
  END IF;

  v_event_day := (COALESCE(p_occurred_at, now()) AT TIME ZONE 'UTC')::date;

  INSERT INTO public.user_progress (chat_id, bot_key)
  VALUES (p_chat_id, p_bot_key)
  ON CONFLICT (chat_id, bot_key) DO NOTHING;

  SELECT *
  INTO v_progress
  FROM public.user_progress up
  WHERE up.chat_id = p_chat_id
    AND up.bot_key = p_bot_key
  FOR UPDATE;

  v_effective_daily := CASE
    WHEN v_progress.xp_daily_date IS DISTINCT FROM v_event_day THEN 0
    ELSE v_progress.xp_daily
  END;

  v_awarded_xp := LEAST(COALESCE(p_requested_xp, 0), GREATEST(250 - v_effective_daily, 0));

  INSERT INTO public.xp_events (
    chat_id,
    bot_key,
    event_type,
    xp_delta,
    idempotency_key,
    occurred_at,
    meta
  )
  VALUES (
    p_chat_id,
    p_bot_key,
    p_event_type,
    v_awarded_xp,
    p_idempotency_key,
    COALESCE(p_occurred_at, now()),
    COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object(
      'requested_xp', COALESCE(p_requested_xp, 0),
      'practice', p_is_practice,
      'day_utc', v_event_day,
      'capped', v_awarded_xp < COALESCE(p_requested_xp, 0)
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING 1 INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN QUERY
    SELECT
      false AS applied,
      0 AS awarded_xp,
      v_progress.xp_total,
      v_progress.xp_daily,
      v_progress.streak_current,
      v_progress.streak_best,
      v_progress.streak_last_day,
      FLOOR(v_progress.xp_total / 200.0)::integer + 1 AS level,
      MOD(v_progress.xp_total, 200) AS xp_into_level,
      CASE
        WHEN v_progress.xp_total = 0 THEN 200
        ELSE 200 - MOD(v_progress.xp_total, 200)
      END AS xp_to_next;
    RETURN;
  END IF;

  v_new_streak := v_progress.streak_current;
  v_new_best := v_progress.streak_best;
  v_new_last_day := v_progress.streak_last_day;

  IF p_is_practice THEN
    IF v_progress.streak_last_day IS NULL THEN
      v_new_streak := 1;
      v_new_last_day := v_event_day;
    ELSIF v_progress.streak_last_day = v_event_day THEN
      NULL;
    ELSIF v_progress.streak_last_day = (v_event_day - 1) THEN
      v_new_streak := v_progress.streak_current + 1;
      v_new_last_day := v_event_day;
    ELSE
      v_new_streak := 1;
      v_new_last_day := v_event_day;
    END IF;

    v_new_best := GREATEST(v_progress.streak_best, v_new_streak);
  END IF;

  UPDATE public.user_progress
  SET xp_total = v_progress.xp_total + v_awarded_xp,
      xp_daily = v_effective_daily + v_awarded_xp,
      xp_daily_date = v_event_day,
      streak_current = v_new_streak,
      streak_best = v_new_best,
      streak_last_day = v_new_last_day,
      updated_at = now()
  WHERE chat_id = p_chat_id
    AND bot_key = p_bot_key
  RETURNING *
  INTO v_progress;

  RETURN QUERY
  SELECT
    true AS applied,
    v_awarded_xp,
    v_progress.xp_total,
    v_progress.xp_daily,
    v_progress.streak_current,
    v_progress.streak_best,
    v_progress.streak_last_day,
    FLOOR(v_progress.xp_total / 200.0)::integer + 1 AS level,
    MOD(v_progress.xp_total, 200) AS xp_into_level,
    CASE
      WHEN v_progress.xp_total = 0 THEN 200
      ELSE 200 - MOD(v_progress.xp_total, 200)
    END AS xp_to_next;
END;
$$;


--
-- Name: log_day1_return_from_user_bot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_day1_return_from_user_bot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.last_seen_at < (NEW.first_seen_at + INTERVAL '1 day') THEN
    RETURN NEW;
  END IF;

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
    'day1_return',
    'db_trigger',
    'day1_return:' || NEW.chat_id::text || ':' || COALESCE(NEW.bot_key, ''),
    NEW.last_seen_at,
    jsonb_build_object(
      'first_seen_at', NEW.first_seen_at,
      'last_seen_at', NEW.last_seen_at
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: log_first_answer_delivered_from_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_first_answer_delivered_from_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.role <> 'assistant' THEN
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
    'first_answer_delivered',
    'db_trigger',
    'first_answer_delivered:' || NEW.chat_id::text || ':' || COALESCE(NEW.bot_key, ''),
    NEW.created_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: log_first_voice_sent_from_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_first_voice_sent_from_message() RETURNS trigger
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


--
-- Name: log_first_voice_sent_from_usage_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_first_voice_sent_from_usage_event() RETURNS trigger
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


--
-- Name: log_free_limit_half_from_usage_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_free_limit_half_from_usage_event() RETURNS trigger
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


--
-- Name: log_profile_set_level_from_user_bot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_profile_set_level_from_user_bot() RETURNS trigger
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_events (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    bot_key text,
    action_type text NOT NULL,
    source text DEFAULT 'unknown'::text NOT NULL,
    idempotency_key text,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT action_events_action_type_check CHECK ((action_type = ANY (ARRAY['start'::text, 'profile_set_level'::text, 'first_voice_sent'::text, 'first_answer_delivered'::text, 'day1_return'::text, 'free_limit_half'::text, 'paywall_shown'::text, 'purchase_success'::text, 'reply_kbd_level_click'::text, 'reply_kbd_voice_click'::text, 'reply_kbd_xp_click'::text, 'idiom_phrase_more_click'::text, 'onboarding_scenario_selected'::text, 'onboarding_practice_sent'::text, 'onboarding_completed'::text, 'onboarding_level_confirmed'::text, 'onboarding_bonus_selected'::text])))
);


--
-- Name: action_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.action_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.action_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_bots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bots (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    level text DEFAULT 'a1'::text NOT NULL,
    reply_mode text DEFAULT 'text'::text NOT NULL,
    tts_voice text DEFAULT 'marin'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    text_voice_nudge_sent boolean DEFAULT false NOT NULL,
    CONSTRAINT user_bots_level_check CHECK ((level = ANY (ARRAY['a1'::text, 'a2'::text, 'b1'::text, 'b2'::text, 'c1'::text]))),
    CONSTRAINT user_bots_reply_mode_check CHECK ((reply_mode = ANY (ARRAY['text'::text, 'voice'::text])))
);


--
-- Name: voice_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_usage_events (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    direction text NOT NULL,
    seconds integer NOT NULL,
    source text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text DEFAULT 'uk-de'::text NOT NULL,
    CONSTRAINT voice_usage_events_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT voice_usage_events_seconds_check CHECK ((seconds >= 0)),
    CONSTRAINT voice_usage_events_source_check CHECK ((source = ANY (ARRAY['telegram_voice_duration'::text, 'tts_estimate'::text, 'tts_actual'::text])))
);


--
-- Name: bot_dau; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bot_dau AS
 SELECT ub.bot_key,
    (date_trunc('day'::text, (v.occurred_at AT TIME ZONE 'UTC'::text)))::date AS day,
    count(DISTINCT v.chat_id) AS dau
   FROM (public.voice_usage_events v
     JOIN public.user_bots ub ON (((ub.chat_id = v.chat_id) AND (ub.bot_key = v.bot_key))))
  WHERE (v.occurred_at >= (now() - '90 days'::interval))
  GROUP BY ub.bot_key, ((date_trunc('day'::text, (v.occurred_at AT TIME ZONE 'UTC'::text)))::date)
  ORDER BY ub.bot_key, ((date_trunc('day'::text, (v.occurred_at AT TIME ZONE 'UTC'::text)))::date) DESC;


--
-- Name: VIEW bot_dau; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.bot_dau IS 'Daily Active Users per bot (last 90 days)';


--
-- Name: bot_message_presentations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_message_presentations (
    message_id bigint NOT NULL,
    telegram_message_id bigint NOT NULL,
    state jsonb NOT NULL,
    pending_audio bytea,
    content_dirty boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_message_presentations_state_check CHECK ((jsonb_typeof(state) = 'object'::text)),
    CONSTRAINT bot_message_presentations_telegram_message_id_check CHECK ((telegram_message_id > 0))
);


--
-- Name: bot_onboarding_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_onboarding_sessions (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    version integer DEFAULT 2 NOT NULL,
    state text DEFAULT 'choose_scenario'::text NOT NULL,
    scenario text,
    first_input_mode text,
    suggested_level text,
    completion_decision_id text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    last_start_update_id bigint,
    CONSTRAINT bot_onboarding_sessions_completion_check CHECK ((((state = 'completed'::text) AND (completed_at IS NOT NULL)) OR ((state <> 'completed'::text) AND (completed_at IS NULL)))),
    CONSTRAINT bot_onboarding_sessions_decision_check CHECK (((completion_decision_id IS NULL) OR (length(completion_decision_id) <= 200))),
    CONSTRAINT bot_onboarding_sessions_input_mode_check CHECK (((first_input_mode IS NULL) OR (first_input_mode = ANY (ARRAY['voice'::text, 'text'::text])))),
    CONSTRAINT bot_onboarding_sessions_level_check CHECK (((suggested_level IS NULL) OR (suggested_level = ANY (ARRAY['a1'::text, 'a2'::text, 'b1'::text, 'b2'::text, 'c1'::text])))),
    CONSTRAINT bot_onboarding_sessions_scenario_check CHECK (((scenario IS NULL) OR (scenario = ANY (ARRAY['about_self'::text, 'daily_life'::text, 'travel'::text, 'freeform'::text])))),
    CONSTRAINT bot_onboarding_sessions_state_check CHECK ((state = ANY (ARRAY['choose_scenario'::text, 'await_practice'::text, 'completed'::text]))),
    CONSTRAINT bot_onboarding_sessions_version_check CHECK ((version > 0))
);


--
-- Name: scheduled_task_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_task_dispatches (
    id bigint NOT NULL,
    task_type text NOT NULL,
    bot_key text NOT NULL,
    chat_id bigint NOT NULL,
    schedule_key text NOT NULL,
    status text DEFAULT 'claimed'::text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    telegram_message_id bigint,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduled_task_dispatches_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: bot_onboarding_completion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bot_onboarding_completion AS
 SELECT ub.chat_id,
    ub.bot_key,
        CASE
            WHEN (session.chat_id IS NOT NULL) THEN session.completed_at
            ELSE legacy.sent_at
        END AS completed_at,
        CASE
            WHEN (session.chat_id IS NOT NULL) THEN 'interactive_v2'::text
            ELSE 'legacy_message'::text
        END AS source
   FROM ((public.user_bots ub
     LEFT JOIN public.bot_onboarding_sessions session ON (((session.chat_id = ub.chat_id) AND (session.bot_key = ub.bot_key))))
     LEFT JOIN LATERAL ( SELECT min(std.sent_at) AS sent_at
           FROM public.scheduled_task_dispatches std
          WHERE ((std.chat_id = ub.chat_id) AND (std.bot_key = ub.bot_key) AND (std.task_type = 'onboarding_complete'::text) AND (std.schedule_key = 'once'::text) AND (std.status = 'sent'::text) AND (std.sent_at IS NOT NULL))) legacy ON (true))
  WHERE (
        CASE
            WHEN (session.chat_id IS NOT NULL) THEN session.completed_at
            ELSE legacy.sent_at
        END IS NOT NULL);


--
-- Name: bot_settings_widget_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_settings_widget_cards (
    decision_id text NOT NULL,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    message_id bigint,
    screen text DEFAULT 'home'::text NOT NULL,
    action_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_settings_widget_cards_screen_check CHECK ((screen = ANY (ARRAY['home'::text, 'stats'::text, 'feedback'::text, 'closed'::text])))
);


--
-- Name: bot_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bot_stats AS
 SELECT bot_key,
    count(DISTINCT chat_id) AS total_users,
    count(DISTINCT chat_id) FILTER (WHERE is_active) AS active_users,
    count(DISTINCT chat_id) FILTER (WHERE (last_seen_at >= (now() - '7 days'::interval))) AS users_last_7_days,
    count(DISTINCT chat_id) FILTER (WHERE (last_seen_at >= (now() - '30 days'::interval))) AS users_last_30_days,
    count(DISTINCT chat_id) FILTER (WHERE (created_at >= (now() - '7 days'::interval))) AS new_users_7_days,
    count(DISTINCT chat_id) FILTER (WHERE (created_at >= (now() - '30 days'::interval))) AS new_users_30_days,
    min(first_seen_at) AS first_user_at,
    max(last_seen_at) AS last_activity_at,
    count(DISTINCT chat_id) FILTER (WHERE (last_seen_at >= (now() - '3 days'::interval))) AS users_last_3_days
   FROM public.user_bots ub
  GROUP BY bot_key;


--
-- Name: VIEW bot_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.bot_stats IS 'Real-time statistics per bot: user counts, activity, and growth metrics';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    chat_id bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username text,
    first_name text,
    plan_tier text DEFAULT 'free'::text NOT NULL,
    plan_started_at timestamp with time zone,
    plan_expires_at timestamp with time zone,
    plan_autorenew boolean DEFAULT false NOT NULL,
    pending_plan_tier text,
    pending_plan_effective_at timestamp with time zone,
    override_plan_tier text,
    override_expires_at timestamp with time zone,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_price_id text,
    stripe_subscription_status text,
    billing_currency text DEFAULT 'EUR'::text NOT NULL,
    acquisition_start_payload text,
    acquisition_start_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    plan_started_tier text,
    inactive_reason text,
    inactive_at timestamp with time zone,
    last_delivery_error text,
    preferred_billing_currency text,
    CONSTRAINT users_inactive_reason_check CHECK (((inactive_reason IS NULL) OR (inactive_reason = ANY (ARRAY['blocked'::text, 'deactivated'::text, 'chat_not_found'::text, 'forbidden'::text])))),
    CONSTRAINT users_preferred_billing_currency_check CHECK (((preferred_billing_currency IS NULL) OR (char_length(preferred_billing_currency) = 3)))
);


--
-- Name: bot_stats_by_tier; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bot_stats_by_tier AS
 SELECT ub.bot_key,
        CASE
            WHEN ((u.override_plan_tier IS NOT NULL) AND (u.override_expires_at IS NOT NULL) AND (now() < u.override_expires_at)) THEN u.override_plan_tier
            WHEN ((u.plan_expires_at IS NOT NULL) AND (now() < u.plan_expires_at)) THEN u.plan_tier
            ELSE 'free'::text
        END AS effective_tier,
    count(DISTINCT ub.chat_id) AS user_count,
    count(DISTINCT ub.chat_id) FILTER (WHERE ub.is_active) AS active_user_count
   FROM (public.user_bots ub
     JOIN public.users u ON ((u.chat_id = ub.chat_id)))
  GROUP BY ub.bot_key,
        CASE
            WHEN ((u.override_plan_tier IS NOT NULL) AND (u.override_expires_at IS NOT NULL) AND (now() < u.override_expires_at)) THEN u.override_plan_tier
            WHEN ((u.plan_expires_at IS NOT NULL) AND (now() < u.plan_expires_at)) THEN u.plan_tier
            ELSE 'free'::text
        END;


--
-- Name: VIEW bot_stats_by_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.bot_stats_by_tier IS 'User distribution by bot and subscription tier';


--
-- Name: bot_update_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_update_deliveries (
    id bigint NOT NULL,
    decision_id text NOT NULL,
    step_key text NOT NULL,
    telegram_method text NOT NULL,
    telegram_message_id bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error_code text,
    error_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_update_deliveries_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT bot_update_deliveries_error_code_length_check CHECK (((error_code IS NULL) OR ((char_length(error_code) >= 1) AND (char_length(error_code) <= 128)))),
    CONSTRAINT bot_update_deliveries_error_detail_length_check CHECK (((error_detail IS NULL) OR ((char_length(error_detail) >= 1) AND (char_length(error_detail) <= 500)))),
    CONSTRAINT bot_update_deliveries_method_length_check CHECK (((char_length(telegram_method) >= 1) AND (char_length(telegram_method) <= 64))),
    CONSTRAINT bot_update_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text, 'unknown'::text]))),
    CONSTRAINT bot_update_deliveries_step_key_length_check CHECK (((char_length(step_key) >= 1) AND (char_length(step_key) <= 96)))
);


--
-- Name: bot_update_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bot_update_deliveries ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.bot_update_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bot_update_effects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_update_effects (
    id bigint NOT NULL,
    decision_id text NOT NULL,
    step_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bot_update_effects_result_object_check CHECK (((result_json IS NULL) OR (jsonb_typeof(result_json) = 'object'::text))),
    CONSTRAINT bot_update_effects_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text]))),
    CONSTRAINT bot_update_effects_step_key_length_check CHECK (((char_length(step_key) >= 1) AND (char_length(step_key) <= 96)))
);


--
-- Name: bot_update_effects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bot_update_effects ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.bot_update_effects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bot_update_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_update_executions (
    decision_id text NOT NULL,
    bot_key text NOT NULL,
    update_id bigint NOT NULL,
    contract_version integer NOT NULL,
    route text NOT NULL,
    handler_version integer NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    current_job_id uuid NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    terminal_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT bot_update_executions_attempts_check CHECK ((attempts > 0)),
    CONSTRAINT bot_update_executions_bot_key_length_check CHECK (((char_length(bot_key) >= 1) AND (char_length(bot_key) <= 32))),
    CONSTRAINT bot_update_executions_contract_version_check CHECK ((contract_version = 1)),
    CONSTRAINT bot_update_executions_decision_id_length_check CHECK (((char_length(decision_id) >= 1) AND (char_length(decision_id) <= 128))),
    CONSTRAINT bot_update_executions_error_length_check CHECK (((terminal_error_code IS NULL) OR ((char_length(terminal_error_code) >= 1) AND (char_length(terminal_error_code) <= 128)))),
    CONSTRAINT bot_update_executions_handler_version_check CHECK ((handler_version > 0)),
    CONSTRAINT bot_update_executions_route_length_check CHECK (((char_length(route) >= 1) AND (char_length(route) <= 64))),
    CONSTRAINT bot_update_executions_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'retryable_failed'::text, 'permanent_failed'::text])))
);


--
-- Name: broadcast_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_campaigns (
    id bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    message_text text NOT NULL,
    total_recipients integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_by text,
    error_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    message_kind text DEFAULT 'text'::text NOT NULL,
    media_url text,
    media_file_id text,
    media_file_ids jsonb,
    reply_markup jsonb,
    CONSTRAINT broadcast_campaigns_media_presence_check CHECK ((((message_kind = 'text'::text) AND (media_url IS NULL) AND (media_file_id IS NULL) AND ((media_file_ids IS NULL) OR (media_file_ids = '{}'::jsonb))) OR ((message_kind = ANY (ARRAY['photo'::text, 'video'::text])) AND ((media_url IS NOT NULL) OR (media_file_id IS NOT NULL) OR ((media_file_ids IS NOT NULL) AND (jsonb_typeof(media_file_ids) = 'object'::text) AND (media_file_ids <> '{}'::jsonb)))))),
    CONSTRAINT broadcast_campaigns_message_kind_check CHECK ((message_kind = ANY (ARRAY['text'::text, 'photo'::text, 'video'::text]))),
    CONSTRAINT broadcast_campaigns_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: broadcast_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_campaigns ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.broadcast_campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: broadcast_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_recipients (
    campaign_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    username text,
    first_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    telegram_message_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text NOT NULL,
    CONSTRAINT broadcast_recipients_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    username text,
    first_name text,
    message_id integer,
    kind text NOT NULL,
    feedback_text text,
    transcript text,
    telegram_file_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text NOT NULL,
    category text,
    source text DEFAULT 'telegram'::text NOT NULL,
    idempotency_key text,
    CONSTRAINT feedback_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['bug'::text, 'idea'::text, 'billing'::text, 'coach'::text])))),
    CONSTRAINT feedback_idempotency_key_check CHECK (((idempotency_key IS NULL) OR ((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200)))),
    CONSTRAINT feedback_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'voice'::text]))),
    CONSTRAINT feedback_source_check CHECK ((source = ANY (ARRAY['telegram'::text, 'miniapp'::text])))
);


--
-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.feedback ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: feedback_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_notifications (
    feedback_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    discord_message_id text,
    transcript_status text DEFAULT 'pending'::text NOT NULL,
    last_error_code text,
    attachment_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT feedback_notifications_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT feedback_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'preparing'::text, 'sending'::text, 'sent'::text, 'unknown'::text, 'failed'::text]))),
    CONSTRAINT feedback_notifications_transcript_status_check CHECK ((transcript_status = ANY (ARRAY['pending'::text, 'complete'::text, 'unavailable'::text, 'none'::text])))
);


--
-- Name: feedback_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_replies (
    id bigint NOT NULL,
    feedback_id bigint,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    message_text text NOT NULL,
    telegram_message_id bigint,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_replies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.feedback_replies ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.feedback_replies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: feedback_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_threads (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    archived_at timestamp with time zone,
    archived_by text,
    user_last_read_at timestamp with time zone
);


--
-- Name: idiom_phrase_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idiom_phrase_catalog (
    id bigint NOT NULL,
    target_language text NOT NULL,
    level_bucket text NOT NULL,
    phrase_text text NOT NULL,
    meaning_text text NOT NULL,
    tone_text text NOT NULL,
    example_text text NOT NULL,
    source_key text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idiom_phrase_catalog_level_bucket_check CHECK ((level_bucket = ANY (ARRAY['a1_a2'::text, 'b1_b2'::text]))),
    CONSTRAINT idiom_phrase_catalog_target_language_check CHECK ((target_language = ANY (ARRAY['en'::text, 'de'::text])))
);


--
-- Name: idiom_phrase_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.idiom_phrase_catalog ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.idiom_phrase_catalog_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: idiom_phrase_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idiom_phrase_deliveries (
    id bigint NOT NULL,
    task_dispatch_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    phrase_id bigint NOT NULL,
    schedule_key text NOT NULL,
    level_bucket text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idiom_phrase_deliveries_level_bucket_check CHECK ((level_bucket = ANY (ARRAY['a1_a2'::text, 'b1_b2'::text])))
);


--
-- Name: idiom_phrase_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.idiom_phrase_deliveries ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.idiom_phrase_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: idiom_phrase_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idiom_phrase_translations (
    id bigint NOT NULL,
    phrase_id bigint NOT NULL,
    base_language text NOT NULL,
    phrase_translation text NOT NULL,
    meaning_translation text NOT NULL,
    tone_translation text NOT NULL,
    example_translation text NOT NULL,
    source text DEFAULT 'llm'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_signature text DEFAULT ''::text NOT NULL,
    CONSTRAINT idiom_phrase_translations_base_language_check CHECK (((char_length(base_language) >= 2) AND (char_length(base_language) <= 8))),
    CONSTRAINT idiom_phrase_translations_source_check CHECK ((source = ANY (ARRAY['llm'::text, 'passthrough'::text])))
);


--
-- Name: idiom_phrase_translations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.idiom_phrase_translations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.idiom_phrase_translations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: llm_call_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_call_events (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    decision_id text,
    chat_id bigint,
    bot_key text NOT NULL,
    route text,
    operation text NOT NULL,
    model text NOT NULL,
    reasoning_effort text,
    duration_ms integer NOT NULL,
    success boolean NOT NULL,
    error_code text,
    input_tokens bigint,
    cached_input_tokens bigint,
    output_tokens bigint,
    reasoning_tokens bigint,
    total_tokens bigint,
    CONSTRAINT llm_call_events_duration_check CHECK ((duration_ms >= 0)),
    CONSTRAINT llm_call_events_error_state_check CHECK ((((success = true) AND (error_code IS NULL)) OR ((success = false) AND (error_code IS NOT NULL)))),
    CONSTRAINT llm_call_events_token_counts_check CHECK (((COALESCE(input_tokens, (0)::bigint) >= 0) AND (COALESCE(cached_input_tokens, (0)::bigint) >= 0) AND (COALESCE(output_tokens, (0)::bigint) >= 0) AND (COALESCE(reasoning_tokens, (0)::bigint) >= 0) AND (COALESCE(total_tokens, (0)::bigint) >= 0)))
);


--
-- Name: llm_call_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.llm_call_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.llm_call_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: loader_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loader_flags (
    chat_id bigint NOT NULL,
    stop_flag boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text NOT NULL,
    session_id text,
    message_id bigint,
    started_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    translation_base text DEFAULT ''::text NOT NULL,
    follow_up_hints text DEFAULT '[]'::text NOT NULL,
    bot_key text DEFAULT 'uk-de'::text NOT NULL,
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    tier text,
    provider text DEFAULT 'stripe'::text NOT NULL,
    amount_cents integer,
    currency text,
    status text,
    stripe_event_id text,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_invoice_id text,
    stripe_checkout_session_id text,
    stripe_payment_intent_id text,
    stripe_price_id text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: pending_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_feedback (
    chat_id bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text NOT NULL,
    session_id text NOT NULL,
    prompt_message_id bigint,
    card_message_id bigint NOT NULL,
    status text DEFAULT 'awaiting'::text NOT NULL,
    completed_feedback_id bigint,
    CONSTRAINT pending_feedback_card_check CHECK ((card_message_id > 0)),
    CONSTRAINT pending_feedback_prompt_check CHECK (((prompt_message_id IS NULL) OR (prompt_message_id > 0))),
    CONSTRAINT pending_feedback_status_check CHECK ((status = ANY (ARRAY['awaiting'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: plan_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_prices (
    id bigint NOT NULL,
    tier text NOT NULL,
    currency text NOT NULL,
    amount_cents integer NOT NULL,
    billing_interval text DEFAULT 'month'::text NOT NULL,
    stripe_price_id text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plan_prices_currency_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT plan_prices_interval_check CHECK ((billing_interval = ANY (ARRAY['month'::text, 'year'::text])))
);


--
-- Name: plan_prices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.plan_prices ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.plan_prices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    tier text NOT NULL,
    voice_seconds_limit integer NOT NULL,
    voice_limit_period text NOT NULL,
    CONSTRAINT plans_voice_limit_period_check CHECK ((voice_limit_period = ANY (ARRAY['lifetime'::text, 'month'::text])))
);


--
-- Name: scheduled_task_dispatches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scheduled_task_dispatches ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.scheduled_task_dispatches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying(128) NOT NULL
);


--
-- Name: usage_hourly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_hourly (
    chat_id bigint NOT NULL,
    hour_start timestamp with time zone NOT NULL,
    in_voice_seconds integer DEFAULT 0 NOT NULL,
    out_voice_seconds integer DEFAULT 0 NOT NULL,
    in_events integer DEFAULT 0 NOT NULL,
    out_events integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_key text DEFAULT 'uk-de'::text NOT NULL
);


--
-- Name: user_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_progress (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    xp_total integer DEFAULT 0 NOT NULL,
    xp_daily integer DEFAULT 0 NOT NULL,
    xp_daily_date date,
    streak_current integer DEFAULT 0 NOT NULL,
    streak_best integer DEFAULT 0 NOT NULL,
    streak_last_day date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_summaries (
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    profile_summary text DEFAULT ''::text NOT NULL,
    short_summary text DEFAULT ''::text NOT NULL
);


--
-- Name: vocabulary_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_analyses (
    id bigint NOT NULL,
    source_message_id bigint,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    decision_id text NOT NULL,
    target_language text NOT NULL,
    source_text text NOT NULL,
    context_text text DEFAULT ''::text NOT NULL,
    source_at timestamp with time zone NOT NULL,
    input_mode text NOT NULL,
    eligible_word_ids bigint[] NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    extracted jsonb,
    judgments jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluator_version text DEFAULT 'vocabulary-v1'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT vocabulary_analyses_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT vocabulary_analyses_check CHECK (((status = 'processing'::text) = ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL)))),
    CONSTRAINT vocabulary_analyses_extracted_check CHECK (((extracted IS NULL) OR (jsonb_typeof(extracted) = 'array'::text))),
    CONSTRAINT vocabulary_analyses_input_mode_check CHECK ((input_mode = ANY (ARRAY['text'::text, 'voice'::text]))),
    CONSTRAINT vocabulary_analyses_judgments_check CHECK ((jsonb_typeof(judgments) = 'array'::text)),
    CONSTRAINT vocabulary_analyses_source_text_check CHECK (((length(source_text) >= 1) AND (length(source_text) <= 20000))),
    CONSTRAINT vocabulary_analyses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT vocabulary_analyses_target_language_check CHECK ((target_language = ANY (ARRAY['de'::text, 'en'::text, 'es'::text])))
);


--
-- Name: vocabulary_analyses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_analyses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_analyses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_analyses_id_seq OWNED BY public.vocabulary_analyses.id;


--
-- Name: vocabulary_daily_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_daily_credits (
    word_id bigint NOT NULL,
    utc_day date NOT NULL,
    usage_id bigint NOT NULL
);


--
-- Name: vocabulary_snapshot_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_snapshot_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    row_index smallint NOT NULL,
    item jsonb NOT NULL,
    lemma text NOT NULL,
    lemma_key text NOT NULL,
    pos text NOT NULL,
    meaning_key text NOT NULL,
    meaning text NOT NULL,
    CONSTRAINT vocabulary_snapshot_rows_item_check CHECK ((jsonb_typeof(item) = 'object'::text)),
    CONSTRAINT vocabulary_snapshot_rows_lemma_check CHECK (((length(TRIM(BOTH FROM lemma)) >= 1) AND (length(TRIM(BOTH FROM lemma)) <= 160))),
    CONSTRAINT vocabulary_snapshot_rows_lemma_key_check CHECK (((length(lemma_key) >= 1) AND (length(lemma_key) <= 160))),
    CONSTRAINT vocabulary_snapshot_rows_meaning_check CHECK (((length(TRIM(BOTH FROM meaning)) >= 1) AND (length(TRIM(BOTH FROM meaning)) <= 1000))),
    CONSTRAINT vocabulary_snapshot_rows_meaning_key_check CHECK (((length(TRIM(BOTH FROM meaning_key)) >= 1) AND (length(TRIM(BOTH FROM meaning_key)) <= 200))),
    CONSTRAINT vocabulary_snapshot_rows_pos_check CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'other'::text]))),
    CONSTRAINT vocabulary_snapshot_rows_row_index_check CHECK (((row_index >= 0) AND (row_index <= 14)))
);


--
-- Name: vocabulary_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    target_language text NOT NULL,
    source_message_id bigint,
    decision_id text NOT NULL,
    telegram_message_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vocabulary_snapshots_target_language_check CHECK ((target_language = ANY (ARRAY['de'::text, 'en'::text, 'es'::text])))
);


--
-- Name: vocabulary_usages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_usages (
    id bigint NOT NULL,
    word_id bigint NOT NULL,
    analysis_id bigint NOT NULL,
    verdict text NOT NULL,
    evidence jsonb NOT NULL,
    CONSTRAINT vocabulary_usages_evidence_check CHECK ((jsonb_typeof(evidence) = 'array'::text)),
    CONSTRAINT vocabulary_usages_verdict_check CHECK ((verdict = ANY (ARRAY['correct'::text, 'incorrect'::text, 'uncertain'::text])))
);


--
-- Name: vocabulary_usages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_usages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_usages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_usages_id_seq OWNED BY public.vocabulary_usages.id;


--
-- Name: vocabulary_words; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vocabulary_words (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    target_language text NOT NULL,
    lemma text NOT NULL,
    lemma_key text NOT NULL,
    pos text NOT NULL,
    meaning_key text NOT NULL,
    meaning text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    active_since timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    progress smallint DEFAULT 0 NOT NULL,
    learned_at timestamp with time zone,
    CONSTRAINT vocabulary_words_check CHECK (((progress = 5) = (learned_at IS NOT NULL))),
    CONSTRAINT vocabulary_words_check1 CHECK ((active_since >= added_at)),
    CONSTRAINT vocabulary_words_lemma_check CHECK (((length(TRIM(BOTH FROM lemma)) >= 1) AND (length(TRIM(BOTH FROM lemma)) <= 160))),
    CONSTRAINT vocabulary_words_lemma_key_check CHECK (((length(lemma_key) >= 1) AND (length(lemma_key) <= 160))),
    CONSTRAINT vocabulary_words_meaning_check CHECK (((length(TRIM(BOTH FROM meaning)) >= 1) AND (length(TRIM(BOTH FROM meaning)) <= 1000))),
    CONSTRAINT vocabulary_words_meaning_key_check CHECK (((length(TRIM(BOTH FROM meaning_key)) >= 1) AND (length(TRIM(BOTH FROM meaning_key)) <= 200))),
    CONSTRAINT vocabulary_words_pos_check CHECK ((pos = ANY (ARRAY['noun'::text, 'verb'::text, 'adjective'::text, 'adverb'::text, 'other'::text]))),
    CONSTRAINT vocabulary_words_progress_check CHECK (((progress >= 0) AND (progress <= 5))),
    CONSTRAINT vocabulary_words_target_language_check CHECK ((target_language = ANY (ARRAY['de'::text, 'en'::text, 'es'::text])))
);


--
-- Name: vocabulary_words_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vocabulary_words_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vocabulary_words_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vocabulary_words_id_seq OWNED BY public.vocabulary_words.id;


--
-- Name: voice_usage_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.voice_usage_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.voice_usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: xp_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xp_events (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    bot_key text NOT NULL,
    event_type text NOT NULL,
    xp_delta integer NOT NULL,
    idempotency_key text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT xp_events_event_type_check CHECK ((event_type = ANY (ARRAY['voice'::text, 'text'::text, 'btn_translation'::text, 'btn_vocab'::text, 'btn_hints'::text, 'btn_idiom_more'::text, 'starter'::text]))),
    CONSTRAINT xp_events_xp_delta_check CHECK ((xp_delta >= 0))
);


--
-- Name: xp_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.xp_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.xp_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: vocabulary_analyses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses ALTER COLUMN id SET DEFAULT nextval('public.vocabulary_analyses_id_seq'::regclass);


--
-- Name: vocabulary_usages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages ALTER COLUMN id SET DEFAULT nextval('public.vocabulary_usages_id_seq'::regclass);


--
-- Name: vocabulary_words id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_words ALTER COLUMN id SET DEFAULT nextval('public.vocabulary_words_id_seq'::regclass);


--
-- Name: action_events action_events_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_events
    ADD CONSTRAINT action_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: action_events action_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_events
    ADD CONSTRAINT action_events_pkey PRIMARY KEY (id);


--
-- Name: bot_message_presentations bot_message_presentations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_message_presentations
    ADD CONSTRAINT bot_message_presentations_pkey PRIMARY KEY (message_id);


--
-- Name: bot_onboarding_sessions bot_onboarding_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_onboarding_sessions
    ADD CONSTRAINT bot_onboarding_sessions_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: bot_settings_widget_cards bot_settings_widget_cards_chat_id_bot_key_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_settings_widget_cards
    ADD CONSTRAINT bot_settings_widget_cards_chat_id_bot_key_message_id_key UNIQUE (chat_id, bot_key, message_id);


--
-- Name: bot_settings_widget_cards bot_settings_widget_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_settings_widget_cards
    ADD CONSTRAINT bot_settings_widget_cards_pkey PRIMARY KEY (decision_id);


--
-- Name: bot_update_deliveries bot_update_deliveries_execution_step_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_deliveries
    ADD CONSTRAINT bot_update_deliveries_execution_step_key UNIQUE (decision_id, step_key);


--
-- Name: bot_update_deliveries bot_update_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_deliveries
    ADD CONSTRAINT bot_update_deliveries_pkey PRIMARY KEY (id);


--
-- Name: bot_update_effects bot_update_effects_execution_step_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_effects
    ADD CONSTRAINT bot_update_effects_execution_step_key UNIQUE (decision_id, step_key);


--
-- Name: bot_update_effects bot_update_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_effects
    ADD CONSTRAINT bot_update_effects_pkey PRIMARY KEY (id);


--
-- Name: bot_update_executions bot_update_executions_bot_update_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_executions
    ADD CONSTRAINT bot_update_executions_bot_update_key UNIQUE (bot_key, update_id);


--
-- Name: bot_update_executions bot_update_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_executions
    ADD CONSTRAINT bot_update_executions_pkey PRIMARY KEY (decision_id);


--
-- Name: broadcast_campaigns broadcast_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_campaigns
    ADD CONSTRAINT broadcast_campaigns_pkey PRIMARY KEY (id);


--
-- Name: broadcast_recipients broadcast_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (campaign_id, chat_id, bot_key);


--
-- Name: feedback feedback_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: feedback_notifications feedback_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_notifications
    ADD CONSTRAINT feedback_notifications_pkey PRIMARY KEY (feedback_id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: feedback_replies feedback_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_replies
    ADD CONSTRAINT feedback_replies_pkey PRIMARY KEY (id);


--
-- Name: feedback_threads feedback_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_threads
    ADD CONSTRAINT feedback_threads_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: idiom_phrase_catalog idiom_phrase_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_catalog
    ADD CONSTRAINT idiom_phrase_catalog_pkey PRIMARY KEY (id);


--
-- Name: idiom_phrase_catalog idiom_phrase_catalog_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_catalog
    ADD CONSTRAINT idiom_phrase_catalog_source_key_key UNIQUE (source_key);


--
-- Name: idiom_phrase_deliveries idiom_phrase_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_deliveries
    ADD CONSTRAINT idiom_phrase_deliveries_pkey PRIMARY KEY (id);


--
-- Name: idiom_phrase_translations idiom_phrase_translations_phrase_id_base_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_translations
    ADD CONSTRAINT idiom_phrase_translations_phrase_id_base_language_key UNIQUE (phrase_id, base_language);


--
-- Name: idiom_phrase_translations idiom_phrase_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_translations
    ADD CONSTRAINT idiom_phrase_translations_pkey PRIMARY KEY (id);


--
-- Name: llm_call_events llm_call_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_call_events
    ADD CONSTRAINT llm_call_events_pkey PRIMARY KEY (id);


--
-- Name: loader_flags loader_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loader_flags
    ADD CONSTRAINT loader_flags_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pending_feedback pending_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_feedback
    ADD CONSTRAINT pending_feedback_pkey PRIMARY KEY (session_id);


--
-- Name: plan_prices plan_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_prices
    ADD CONSTRAINT plan_prices_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (tier);


--
-- Name: scheduled_task_dispatches scheduled_task_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_task_dispatches
    ADD CONSTRAINT scheduled_task_dispatches_pkey PRIMARY KEY (id);


--
-- Name: scheduled_task_dispatches scheduled_task_dispatches_task_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_task_dispatches
    ADD CONSTRAINT scheduled_task_dispatches_task_scope_key UNIQUE (task_type, bot_key, chat_id, schedule_key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: usage_hourly usage_hourly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_hourly
    ADD CONSTRAINT usage_hourly_pkey PRIMARY KEY (chat_id, bot_key, hour_start);


--
-- Name: user_bots user_bots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bots
    ADD CONSTRAINT user_bots_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: user_progress user_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_progress
    ADD CONSTRAINT user_progress_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: user_summaries user_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_summaries
    ADD CONSTRAINT user_summaries_pkey PRIMARY KEY (chat_id, bot_key);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (chat_id);


--
-- Name: vocabulary_analyses vocabulary_analyses_decision_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses
    ADD CONSTRAINT vocabulary_analyses_decision_id_key UNIQUE (decision_id);


--
-- Name: vocabulary_analyses vocabulary_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses
    ADD CONSTRAINT vocabulary_analyses_pkey PRIMARY KEY (id);


--
-- Name: vocabulary_analyses vocabulary_analyses_source_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses
    ADD CONSTRAINT vocabulary_analyses_source_message_id_key UNIQUE (source_message_id);


--
-- Name: vocabulary_daily_credits vocabulary_daily_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_daily_credits
    ADD CONSTRAINT vocabulary_daily_credits_pkey PRIMARY KEY (word_id, utc_day);


--
-- Name: vocabulary_daily_credits vocabulary_daily_credits_usage_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_daily_credits
    ADD CONSTRAINT vocabulary_daily_credits_usage_id_key UNIQUE (usage_id);


--
-- Name: vocabulary_snapshot_rows vocabulary_snapshot_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshot_rows
    ADD CONSTRAINT vocabulary_snapshot_rows_pkey PRIMARY KEY (id);


--
-- Name: vocabulary_snapshot_rows vocabulary_snapshot_rows_snapshot_id_row_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshot_rows
    ADD CONSTRAINT vocabulary_snapshot_rows_snapshot_id_row_index_key UNIQUE (snapshot_id, row_index);


--
-- Name: vocabulary_snapshots vocabulary_snapshots_chat_id_bot_key_telegram_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshots
    ADD CONSTRAINT vocabulary_snapshots_chat_id_bot_key_telegram_message_id_key UNIQUE (chat_id, bot_key, telegram_message_id);


--
-- Name: vocabulary_snapshots vocabulary_snapshots_decision_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshots
    ADD CONSTRAINT vocabulary_snapshots_decision_id_key UNIQUE (decision_id);


--
-- Name: vocabulary_snapshots vocabulary_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshots
    ADD CONSTRAINT vocabulary_snapshots_pkey PRIMARY KEY (id);


--
-- Name: vocabulary_usages vocabulary_usages_id_word_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages
    ADD CONSTRAINT vocabulary_usages_id_word_id_key UNIQUE (id, word_id);


--
-- Name: vocabulary_usages vocabulary_usages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages
    ADD CONSTRAINT vocabulary_usages_pkey PRIMARY KEY (id);


--
-- Name: vocabulary_usages vocabulary_usages_word_id_analysis_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages
    ADD CONSTRAINT vocabulary_usages_word_id_analysis_id_key UNIQUE (word_id, analysis_id);


--
-- Name: vocabulary_words vocabulary_words_chat_id_target_language_lemma_key_pos_mean_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_words
    ADD CONSTRAINT vocabulary_words_chat_id_target_language_lemma_key_pos_mean_key UNIQUE (chat_id, target_language, lemma_key, pos, meaning_key);


--
-- Name: vocabulary_words vocabulary_words_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_words
    ADD CONSTRAINT vocabulary_words_pkey PRIMARY KEY (id);


--
-- Name: voice_usage_events voice_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_usage_events
    ADD CONSTRAINT voice_usage_events_pkey PRIMARY KEY (id);


--
-- Name: xp_events xp_events_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_events
    ADD CONSTRAINT xp_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: xp_events xp_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_events
    ADD CONSTRAINT xp_events_pkey PRIMARY KEY (id);


--
-- Name: bot_update_deliveries_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bot_update_deliveries_status_updated_idx ON public.bot_update_deliveries USING btree (status, updated_at);


--
-- Name: bot_update_effects_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bot_update_effects_status_updated_idx ON public.bot_update_effects USING btree (status, updated_at);


--
-- Name: bot_update_executions_status_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bot_update_executions_status_lease_idx ON public.bot_update_executions USING btree (status, lease_expires_at, updated_at);


--
-- Name: idx_action_events_action_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_events_action_occurred ON public.action_events USING btree (action_type, occurred_at DESC);


--
-- Name: idx_action_events_bot_action_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_events_bot_action_occurred ON public.action_events USING btree (bot_key, action_type, occurred_at DESC);


--
-- Name: idx_action_events_chat_action_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_events_chat_action_occurred ON public.action_events USING btree (chat_id, action_type, occurred_at DESC);


--
-- Name: idx_action_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_events_occurred ON public.action_events USING btree (occurred_at DESC);


--
-- Name: idx_bot_onboarding_sessions_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_onboarding_sessions_state_updated ON public.bot_onboarding_sessions USING btree (state, updated_at);


--
-- Name: idx_broadcast_campaigns_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_campaigns_status_created_at ON public.broadcast_campaigns USING btree (status, created_at DESC);


--
-- Name: idx_broadcast_recipients_campaign_chat_bot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_campaign_chat_bot ON public.broadcast_recipients USING btree (campaign_id, chat_id, bot_key);


--
-- Name: idx_broadcast_recipients_campaign_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_campaign_status ON public.broadcast_recipients USING btree (campaign_id, status, updated_at DESC);


--
-- Name: idx_broadcast_recipients_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_chat_id ON public.broadcast_recipients USING btree (chat_id);


--
-- Name: idx_feedback_chat_bot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_chat_bot_id ON public.feedback USING btree (chat_id, bot_key, id DESC);


--
-- Name: idx_feedback_chat_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_chat_id_id ON public.feedback USING btree (chat_id, id DESC);


--
-- Name: idx_feedback_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_created_at ON public.feedback USING btree (created_at);


--
-- Name: idx_feedback_notifications_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_notifications_pending ON public.feedback_notifications USING btree (next_attempt_at, feedback_id) WHERE (status = 'pending'::text);


--
-- Name: idx_feedback_replies_chat_bot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_replies_chat_bot_id ON public.feedback_replies USING btree (chat_id, bot_key, id DESC);


--
-- Name: idx_feedback_replies_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_replies_created_at ON public.feedback_replies USING btree (created_at);


--
-- Name: idx_feedback_threads_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_threads_archived_at ON public.feedback_threads USING btree (archived_at);


--
-- Name: idx_idiom_phrase_catalog_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idiom_phrase_catalog_lookup ON public.idiom_phrase_catalog USING btree (target_language, level_bucket, is_active, id);


--
-- Name: idx_idiom_phrase_deliveries_dispatch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idiom_phrase_deliveries_dispatch_id ON public.idiom_phrase_deliveries USING btree (task_dispatch_id);


--
-- Name: idx_idiom_phrase_deliveries_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idiom_phrase_deliveries_lookup ON public.idiom_phrase_deliveries USING btree (chat_id, bot_key, phrase_id, sent_at DESC);


--
-- Name: idx_idiom_phrase_translations_phrase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idiom_phrase_translations_phrase_id ON public.idiom_phrase_translations USING btree (phrase_id);


--
-- Name: idx_idiom_phrase_translations_phrase_id_base_language_signature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idiom_phrase_translations_phrase_id_base_language_signature ON public.idiom_phrase_translations USING btree (phrase_id, base_language, source_signature);


--
-- Name: idx_llm_call_events_bot_operation_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_call_events_bot_operation_occurred ON public.llm_call_events USING btree (bot_key, operation, occurred_at DESC);


--
-- Name: idx_llm_call_events_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_call_events_decision ON public.llm_call_events USING btree (decision_id) WHERE (decision_id IS NOT NULL);


--
-- Name: idx_llm_call_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_call_events_occurred ON public.llm_call_events USING btree (occurred_at DESC);


--
-- Name: idx_messages_chat_bot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_bot_id ON public.messages USING btree (chat_id, bot_key, id DESC);


--
-- Name: idx_messages_chat_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_id_id ON public.messages USING btree (chat_id, id DESC);


--
-- Name: idx_payments_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_chat_id ON public.payments USING btree (chat_id);


--
-- Name: idx_payments_stripe_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payments_stripe_event_id ON public.payments USING btree (stripe_event_id) WHERE (stripe_event_id IS NOT NULL);


--
-- Name: idx_payments_stripe_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_stripe_invoice_id ON public.payments USING btree (stripe_invoice_id) WHERE (stripe_invoice_id IS NOT NULL);


--
-- Name: idx_payments_stripe_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_stripe_subscription_id ON public.payments USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: idx_pending_feedback_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_feedback_expires_at ON public.pending_feedback USING btree (expires_at);


--
-- Name: idx_plan_prices_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_prices_active ON public.plan_prices USING btree (active) WHERE active;


--
-- Name: idx_plan_prices_stripe_price_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_plan_prices_stripe_price_id ON public.plan_prices USING btree (stripe_price_id);


--
-- Name: idx_plan_prices_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_plan_prices_unique ON public.plan_prices USING btree (tier, currency, billing_interval);


--
-- Name: idx_scheduled_task_dispatches_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_task_dispatches_chat_id ON public.scheduled_task_dispatches USING btree (chat_id);


--
-- Name: idx_scheduled_task_dispatches_status_claim_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_task_dispatches_status_claim_expires ON public.scheduled_task_dispatches USING btree (status, claim_expires_at, updated_at DESC);


--
-- Name: idx_usage_hourly_bot_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_hourly_bot_hour ON public.usage_hourly USING btree (bot_key, hour_start);


--
-- Name: idx_usage_hourly_chat_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_hourly_chat_hour ON public.usage_hourly USING btree (chat_id, hour_start);


--
-- Name: idx_usage_hourly_hour_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_hourly_hour_start ON public.usage_hourly USING btree (hour_start);


--
-- Name: idx_user_bots_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bots_active ON public.user_bots USING btree (bot_key, is_active) WHERE (is_active = true);


--
-- Name: idx_user_bots_bot_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bots_bot_key ON public.user_bots USING btree (bot_key);


--
-- Name: idx_user_bots_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bots_last_seen ON public.user_bots USING btree (bot_key, last_seen_at DESC);


--
-- Name: idx_users_acquisition_start_payload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_acquisition_start_payload ON public.users USING btree (acquisition_start_payload);


--
-- Name: idx_users_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_at ON public.users USING btree (created_at);


--
-- Name: idx_users_inactive_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_inactive_at ON public.users USING btree (inactive_at) WHERE (inactive_at IS NOT NULL);


--
-- Name: idx_users_pending_plan_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_pending_plan_effective_at ON public.users USING btree (pending_plan_effective_at) WHERE (pending_plan_tier IS NOT NULL);


--
-- Name: idx_users_plan_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_plan_expires_at ON public.users USING btree (plan_expires_at);


--
-- Name: idx_users_plan_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_plan_started_at ON public.users USING btree (plan_started_at) WHERE (plan_started_at IS NOT NULL);


--
-- Name: idx_users_plan_started_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_plan_started_tier ON public.users USING btree (plan_started_tier) WHERE (plan_started_tier IS NOT NULL);


--
-- Name: idx_users_stripe_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_stripe_customer_id ON public.users USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_users_stripe_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_stripe_subscription_id ON public.users USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: idx_voice_usage_events_bot_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_usage_events_bot_occurred ON public.voice_usage_events USING btree (bot_key, occurred_at DESC);


--
-- Name: idx_voice_usage_events_chat_bot_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_usage_events_chat_bot_occurred ON public.voice_usage_events USING btree (chat_id, bot_key, occurred_at DESC);


--
-- Name: idx_voice_usage_events_chat_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_usage_events_chat_occurred ON public.voice_usage_events USING btree (chat_id, occurred_at DESC);


--
-- Name: idx_voice_usage_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_usage_events_occurred ON public.voice_usage_events USING btree (occurred_at DESC);


--
-- Name: idx_xp_events_chat_bot_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_xp_events_chat_bot_time ON public.xp_events USING btree (chat_id, bot_key, occurred_at DESC);


--
-- Name: pending_feedback_active_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pending_feedback_active_scope ON public.pending_feedback USING btree (chat_id, bot_key) WHERE (status = 'awaiting'::text);


--
-- Name: pending_feedback_prompt_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pending_feedback_prompt_scope ON public.pending_feedback USING btree (chat_id, bot_key, prompt_message_id) WHERE (prompt_message_id IS NOT NULL);


--
-- Name: plan_prices_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_prices_active ON public.plan_prices USING btree (active) WHERE active;


--
-- Name: plan_prices_stripe_price_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX plan_prices_stripe_price_id_key ON public.plan_prices USING btree (stripe_price_id);


--
-- Name: plan_prices_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX plan_prices_unique ON public.plan_prices USING btree (tier, currency, billing_interval);


--
-- Name: vocabulary_analyses_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_analyses_pending_idx ON public.vocabulary_analyses USING btree (next_attempt_at, id) WHERE (status = 'pending'::text);


--
-- Name: vocabulary_snapshot_rows_senses_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_snapshot_rows_senses_idx ON public.vocabulary_snapshot_rows USING btree (lemma_key, pos);


--
-- Name: vocabulary_snapshots_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_snapshots_owner_idx ON public.vocabulary_snapshots USING btree (chat_id, target_language);


--
-- Name: vocabulary_words_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vocabulary_words_active_idx ON public.vocabulary_words USING btree (chat_id, target_language, lemma_key) WHERE ((archived_at IS NULL) AND (progress < 5));


--
-- Name: user_bots trg_action_day1_return; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_day1_return AFTER INSERT OR UPDATE OF last_seen_at ON public.user_bots FOR EACH ROW EXECUTE FUNCTION public.log_day1_return_from_user_bot();


--
-- Name: messages trg_action_first_answer_delivered; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_first_answer_delivered AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.log_first_answer_delivered_from_message();


--
-- Name: voice_usage_events trg_action_first_voice_sent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_first_voice_sent AFTER INSERT ON public.voice_usage_events FOR EACH ROW EXECUTE FUNCTION public.log_first_voice_sent_from_usage_event();


--
-- Name: messages trg_action_first_voice_sent_from_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_first_voice_sent_from_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.log_first_voice_sent_from_message();


--
-- Name: voice_usage_events trg_action_free_limit_half; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_free_limit_half AFTER INSERT ON public.voice_usage_events FOR EACH ROW EXECUTE FUNCTION public.log_free_limit_half_from_usage_event();


--
-- Name: user_bots trg_action_profile_set_level; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_action_profile_set_level AFTER UPDATE OF level ON public.user_bots FOR EACH ROW EXECUTE FUNCTION public.log_profile_set_level_from_user_bot();


--
-- Name: bot_message_presentations bot_message_presentations_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_message_presentations
    ADD CONSTRAINT bot_message_presentations_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: bot_onboarding_sessions bot_onboarding_sessions_user_bot_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_onboarding_sessions
    ADD CONSTRAINT bot_onboarding_sessions_user_bot_fkey FOREIGN KEY (chat_id, bot_key) REFERENCES public.user_bots(chat_id, bot_key) ON DELETE CASCADE;


--
-- Name: bot_settings_widget_cards bot_settings_widget_cards_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_settings_widget_cards
    ADD CONSTRAINT bot_settings_widget_cards_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.bot_update_executions(decision_id) ON DELETE CASCADE;


--
-- Name: bot_update_deliveries bot_update_deliveries_execution_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_deliveries
    ADD CONSTRAINT bot_update_deliveries_execution_fkey FOREIGN KEY (decision_id) REFERENCES public.bot_update_executions(decision_id) ON DELETE CASCADE;


--
-- Name: bot_update_effects bot_update_effects_execution_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_update_effects
    ADD CONSTRAINT bot_update_effects_execution_fkey FOREIGN KEY (decision_id) REFERENCES public.bot_update_executions(decision_id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE;


--
-- Name: feedback_notifications feedback_notifications_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_notifications
    ADD CONSTRAINT feedback_notifications_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedback(id) ON DELETE CASCADE;


--
-- Name: feedback_replies feedback_replies_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_replies
    ADD CONSTRAINT feedback_replies_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedback(id) ON DELETE SET NULL;


--
-- Name: idiom_phrase_deliveries idiom_phrase_deliveries_phrase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_deliveries
    ADD CONSTRAINT idiom_phrase_deliveries_phrase_id_fkey FOREIGN KEY (phrase_id) REFERENCES public.idiom_phrase_catalog(id) ON DELETE CASCADE;


--
-- Name: idiom_phrase_deliveries idiom_phrase_deliveries_task_dispatch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_deliveries
    ADD CONSTRAINT idiom_phrase_deliveries_task_dispatch_id_fkey FOREIGN KEY (task_dispatch_id) REFERENCES public.scheduled_task_dispatches(id) ON DELETE CASCADE;


--
-- Name: idiom_phrase_deliveries idiom_phrase_deliveries_user_bot_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_deliveries
    ADD CONSTRAINT idiom_phrase_deliveries_user_bot_fkey FOREIGN KEY (chat_id, bot_key) REFERENCES public.user_bots(chat_id, bot_key) ON DELETE CASCADE;


--
-- Name: idiom_phrase_translations idiom_phrase_translations_phrase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idiom_phrase_translations
    ADD CONSTRAINT idiom_phrase_translations_phrase_id_fkey FOREIGN KEY (phrase_id) REFERENCES public.idiom_phrase_catalog(id) ON DELETE CASCADE;


--
-- Name: pending_feedback pending_feedback_completed_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_feedback
    ADD CONSTRAINT pending_feedback_completed_feedback_id_fkey FOREIGN KEY (completed_feedback_id) REFERENCES public.feedback(id);


--
-- Name: plan_prices plan_prices_tier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_prices
    ADD CONSTRAINT plan_prices_tier_fkey FOREIGN KEY (tier) REFERENCES public.plans(tier) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: scheduled_task_dispatches scheduled_task_dispatches_user_bot_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_task_dispatches
    ADD CONSTRAINT scheduled_task_dispatches_user_bot_fkey FOREIGN KEY (chat_id, bot_key) REFERENCES public.user_bots(chat_id, bot_key) ON DELETE CASCADE;


--
-- Name: user_bots user_bots_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bots
    ADD CONSTRAINT user_bots_user_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE;


--
-- Name: user_summaries user_summaries_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_summaries
    ADD CONSTRAINT user_summaries_user_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE;


--
-- Name: vocabulary_analyses vocabulary_analyses_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses
    ADD CONSTRAINT vocabulary_analyses_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE;


--
-- Name: vocabulary_analyses vocabulary_analyses_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_analyses
    ADD CONSTRAINT vocabulary_analyses_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: vocabulary_daily_credits vocabulary_daily_credits_usage_id_word_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_daily_credits
    ADD CONSTRAINT vocabulary_daily_credits_usage_id_word_id_fkey FOREIGN KEY (usage_id, word_id) REFERENCES public.vocabulary_usages(id, word_id) ON DELETE CASCADE;


--
-- Name: vocabulary_daily_credits vocabulary_daily_credits_word_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_daily_credits
    ADD CONSTRAINT vocabulary_daily_credits_word_id_fkey FOREIGN KEY (word_id) REFERENCES public.vocabulary_words(id) ON DELETE CASCADE;


--
-- Name: vocabulary_snapshot_rows vocabulary_snapshot_rows_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshot_rows
    ADD CONSTRAINT vocabulary_snapshot_rows_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.vocabulary_snapshots(id) ON DELETE CASCADE;


--
-- Name: vocabulary_snapshots vocabulary_snapshots_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshots
    ADD CONSTRAINT vocabulary_snapshots_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE;


--
-- Name: vocabulary_snapshots vocabulary_snapshots_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_snapshots
    ADD CONSTRAINT vocabulary_snapshots_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: vocabulary_usages vocabulary_usages_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages
    ADD CONSTRAINT vocabulary_usages_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.vocabulary_analyses(id) ON DELETE CASCADE;


--
-- Name: vocabulary_usages vocabulary_usages_word_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_usages
    ADD CONSTRAINT vocabulary_usages_word_id_fkey FOREIGN KEY (word_id) REFERENCES public.vocabulary_words(id) ON DELETE CASCADE;


--
-- Name: vocabulary_words vocabulary_words_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vocabulary_words
    ADD CONSTRAINT vocabulary_words_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.users(chat_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260202145821'),
    ('20260203120000'),
    ('20260203130000'),
    ('20260204100000'),
    ('20260204140000'),
    ('20260206123000'),
    ('20260206150000'),
    ('20260206163000'),
    ('20260207100000'),
    ('20260207110000'),
    ('20260207123000'),
    ('20260207140000'),
    ('20260209121000'),
    ('20260209170000'),
    ('20260210120000'),
    ('20260210133000'),
    ('20260212120000'),
    ('20260213113000'),
    ('20260213173000'),
    ('20260219120000'),
    ('20260223130000'),
    ('20260223160000'),
    ('20260223173000'),
    ('20260227110000'),
    ('20260227113000'),
    ('20260227154500'),
    ('20260302120000'),
    ('20260302153000'),
    ('20260303110000'),
    ('20260304100000'),
    ('20260304130000'),
    ('20260304143000'),
    ('20260304150000'),
    ('20260304170000'),
    ('20260305100000'),
    ('20260306110000'),
    ('20260306130000'),
    ('20260307220402'),
    ('20260309110000'),
    ('20260309123000'),
    ('20260310120000'),
    ('20260311103000'),
    ('20260311110000'),
    ('20260311120000'),
    ('20260311124500'),
    ('20260311143000'),
    ('20260312110000'),
    ('20260312113000'),
    ('20260313100000'),
    ('20260313130000'),
    ('20260317113000'),
    ('20260321110000'),
    ('20260321123000'),
    ('20260328110000'),
    ('20260328193000'),
    ('20260710120000'),
    ('20260711100000'),
    ('20260712100000'),
    ('20260715100000'),
    ('20260715113000'),
    ('20261110130000'),
    ('20261111140000'),
    ('20261111160000'),
    ('20261112190000'),
    ('20261112200000'),
    ('20261112201000'),
    ('20261112210000'),
    ('20261113220000'),
    ('20261114090000');
