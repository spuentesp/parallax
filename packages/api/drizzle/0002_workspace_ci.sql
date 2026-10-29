CREATE TABLE workspace_ci (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id),
  mode TEXT NOT NULL DEFAULT 'off',
  base_branch TEXT,
  report_comments INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
