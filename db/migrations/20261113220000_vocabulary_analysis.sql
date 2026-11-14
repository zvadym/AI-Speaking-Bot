-- migrate:up
CREATE TABLE vocabulary_words (
  id bigserial PRIMARY KEY,
  chat_id bigint NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  target_language text NOT NULL CHECK (target_language IN ('de','en','es')),
  lemma text NOT NULL CHECK (length(trim(lemma)) BETWEEN 1 AND 160),
  lemma_key text NOT NULL CHECK (length(lemma_key) BETWEEN 1 AND 160),
  pos text NOT NULL CHECK (pos IN ('noun','verb','adjective','adverb','other')),
  meaning_key text NOT NULL CHECK (length(trim(meaning_key)) BETWEEN 1 AND 200),
  meaning text NOT NULL CHECK (length(trim(meaning)) BETWEEN 1 AND 1000),
  added_at timestamptz NOT NULL DEFAULT now(),
  active_since timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 5),
  learned_at timestamptz,
  CHECK ((progress = 5) = (learned_at IS NOT NULL)),
  CHECK (active_since >= added_at),
  UNIQUE (chat_id,target_language,lemma_key,pos,meaning_key)
);
CREATE INDEX vocabulary_words_active_idx ON vocabulary_words(chat_id,target_language,lemma_key)
  WHERE archived_at IS NULL AND progress < 5;

CREATE TABLE vocabulary_analyses (
  id bigserial PRIMARY KEY,
  source_message_id bigint UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  chat_id bigint NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  bot_key text NOT NULL,
  decision_id text NOT NULL UNIQUE,
  target_language text NOT NULL CHECK (target_language IN ('de','en','es')),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 20000),
  context_text text NOT NULL DEFAULT '',
  source_at timestamptz NOT NULL,
  input_mode text NOT NULL CHECK (input_mode IN ('text','voice')),
  eligible_word_ids bigint[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  extracted jsonb CHECK (extracted IS NULL OR jsonb_typeof(extracted)='array'),
  judgments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(judgments)='array'),
  evaluator_version text NOT NULL DEFAULT 'vocabulary-v1',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status='processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX vocabulary_analyses_pending_idx ON vocabulary_analyses(next_attempt_at,id) WHERE status='pending';

CREATE TABLE vocabulary_usages (
  id bigserial PRIMARY KEY,
  word_id bigint NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  analysis_id bigint NOT NULL REFERENCES vocabulary_analyses(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('correct','incorrect','uncertain')),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='array'),
  UNIQUE (word_id,analysis_id),
  UNIQUE (id,word_id)
);
CREATE TABLE vocabulary_daily_credits (
  word_id bigint NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  utc_day date NOT NULL,
  usage_id bigint NOT NULL UNIQUE,
  PRIMARY KEY (word_id,utc_day),
  FOREIGN KEY (usage_id,word_id) REFERENCES vocabulary_usages(id,word_id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE vocabulary_daily_credits;
DROP TABLE vocabulary_usages;
DROP TABLE vocabulary_analyses;
DROP TABLE vocabulary_words;
