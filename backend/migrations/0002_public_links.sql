PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_public_token ON documents(public_token) WHERE public_token IS NOT NULL;
