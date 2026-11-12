CREATE TABLE gitlab_webhook_inbox (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_gitlab_webhook_pending ON gitlab_webhook_inbox (completed_at);
