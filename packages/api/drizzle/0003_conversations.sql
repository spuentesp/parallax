-- Conversaciones del investigador (memoria). `owner` es un hash del token de
-- acceso (nunca el token). `workspace_id` no es FK: /api/query acepta un org que
-- aún no es un workspace configurado.
CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_conversation_owner ON conversation(owner, workspace_id, updated_at);

CREATE TABLE turn (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  focus_json TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, seq)
);
