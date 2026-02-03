--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    chat_id bigint NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
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
    tier text NOT NULL,
    stars_amount integer NOT NULL,
    invoice_payload text NOT NULL,
    telegram_payment_charge_id text NOT NULL,
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
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    tier text NOT NULL,
    user_audio_seconds_per_week integer NOT NULL,
    tts_seconds_per_week integer NOT NULL,
    price_stars integer DEFAULT 0 NOT NULL
);


--
-- Name: usage_week; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_week (
    chat_id bigint NOT NULL,
    week_start date NOT NULL,
    user_audio_seconds integer DEFAULT 0 NOT NULL,
    tts_seconds integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    chat_id bigint NOT NULL,
    target_lang text DEFAULT 'en'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    level text DEFAULT 'B1'::text NOT NULL,
    onboarding_state text DEFAULT 'ready'::text NOT NULL,
    reply_mode text DEFAULT 'text'::text NOT NULL,
    tts_voice text DEFAULT 'marin'::text NOT NULL,
    username text,
    first_name text,
    plan_tier text DEFAULT 'free'::text NOT NULL,
    plan_started_at timestamp with time zone,
    plan_expires_at timestamp with time zone,
    stars_subscription_id text
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
-- Name: payments payments_telegram_payment_charge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_telegram_payment_charge_id_key UNIQUE (telegram_payment_charge_id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (tier);


--
-- Name: usage_week usage_week_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_week
    ADD CONSTRAINT usage_week_pkey PRIMARY KEY (chat_id, week_start);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (chat_id);


--
-- Name: idx_messages_chat_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_id_id ON public.messages USING btree (chat_id, id DESC);


--
-- Name: idx_payments_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_chat_id ON public.payments USING btree (chat_id);


--
-- Name: idx_usage_week_chat_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_week_chat_week ON public.usage_week USING btree (chat_id, week_start);


--
-- PostgreSQL database dump complete
--

