-- migrate:up
CREATE TABLE bot_settings_widget_cards (
  decision_id text PRIMARY KEY REFERENCES bot_update_executions(decision_id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  bot_key text NOT NULL,
  message_id bigint,
  screen text NOT NULL DEFAULT 'home' CHECK (screen IN ('home','stats','feedback','closed')),
  action_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id,bot_key,message_id)
);

-- migrate:down
-- Forward-only: preserve delivered-card ownership records.
