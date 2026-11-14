-- migrate:up
CREATE TABLE vocabulary_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  bot_key text NOT NULL,
  target_language text NOT NULL CHECK (target_language IN ('de','en','es')),
  source_message_id bigint REFERENCES messages(id) ON DELETE SET NULL,
  decision_id text NOT NULL UNIQUE,
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id,bot_key,telegram_message_id)
);
CREATE TABLE vocabulary_snapshot_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES vocabulary_snapshots(id) ON DELETE CASCADE,
  row_index smallint NOT NULL CHECK (row_index BETWEEN 0 AND 14),
  item jsonb NOT NULL CHECK (jsonb_typeof(item)='object'),
  lemma text NOT NULL CHECK (length(trim(lemma)) BETWEEN 1 AND 160),
  lemma_key text NOT NULL CHECK (length(lemma_key) BETWEEN 1 AND 160),
  pos text NOT NULL CHECK (pos IN ('noun','verb','adjective','adverb','other')),
  meaning_key text NOT NULL CHECK (length(trim(meaning_key)) BETWEEN 1 AND 200),
  meaning text NOT NULL CHECK (length(trim(meaning)) BETWEEN 1 AND 1000),
  UNIQUE (snapshot_id,row_index)
);
CREATE INDEX vocabulary_snapshots_owner_idx ON vocabulary_snapshots(chat_id,target_language);
CREATE INDEX vocabulary_snapshot_rows_senses_idx ON vocabulary_snapshot_rows(lemma_key,pos);

-- migrate:down
DROP TABLE vocabulary_snapshot_rows;
DROP TABLE vocabulary_snapshots;
