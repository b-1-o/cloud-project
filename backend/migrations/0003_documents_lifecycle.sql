PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE documents ADD COLUMN archived_at TEXT;
ALTER TABLE documents ADD COLUMN last_content_preview TEXT;
ALTER TABLE documents ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_documents_workspace_lifecycle
  ON documents(workspace_id, deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id),
  label TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc_time
  ON document_versions(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  thread_id TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anchor_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_comments_document
  ON comments(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_thread
  ON comments(thread_id, created_at ASC);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  last_content_preview
);
