CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  uri TEXT NOT NULL,
  sha TEXT,
  local TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repo_workspace ON repo(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_uri ON repo(workspace_id, uri);

CREATE TABLE IF NOT EXISTS assessment (
  id TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  base_id TEXT,
  head_id TEXT,
  manifest_json TEXT NOT NULL,
  engine_json TEXT,
  coverage_json TEXT,
  org_id TEXT NOT NULL REFERENCES workspace(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_assessment_status ON assessment(status);
CREATE INDEX IF NOT EXISTS idx_assessment_org ON assessment(org_id);

CREATE TABLE IF NOT EXISTS explanation (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  revision INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(assessment_id, revision)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  view_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  path TEXT NOT NULL,
  range_json TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_assessment ON evidence(assessment_id);

CREATE TABLE IF NOT EXISTS job_step (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  step TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  artifact_hash TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(assessment_id, step, attempt)
);

CREATE TABLE IF NOT EXISTS event (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(assessment_id, seq)
);

CREATE TABLE IF NOT EXISTS publication (
  assessment_id TEXT NOT NULL REFERENCES assessment(id),
  target TEXT NOT NULL,
  state TEXT NOT NULL,
  marker TEXT NOT NULL,
  remote_id TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(assessment_id, target)
);
