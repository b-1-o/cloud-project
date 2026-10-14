CREATE TABLE IF NOT EXISTS document_stats (
  document_id text PRIMARY KEY,
  update_count bigint NOT NULL DEFAULT 0,
  last_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_activity (
  event_id text PRIMARY KEY,
  user_id text NOT NULL,
  document_id text,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS search_index (
  document_id text PRIMARY KEY,
  title text NOT NULL,
  content_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_activity_time ON user_activity (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_index_title ON search_index (title);
