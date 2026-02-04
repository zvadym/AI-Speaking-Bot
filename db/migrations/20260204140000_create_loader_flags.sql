-- Create loader_flags for async loader stop signaling
CREATE TABLE IF NOT EXISTS loader_flags (
  chat_id BIGINT PRIMARY KEY,
  stop_flag BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
