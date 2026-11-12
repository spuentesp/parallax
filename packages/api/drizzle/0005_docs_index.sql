-- Índice local de la documentación de los repos (ADRs, AGENTS.md, README, docs/): se lee del
-- checkout, se parte por títulos y se busca con FTS5. No depende del motor en cada pregunta.
CREATE TABLE doc_file (
  workspace_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sha TEXT,
  indexed_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, repo, path)
);

CREATE VIRTUAL TABLE doc_section_fts USING fts5(
  workspace_id UNINDEXED,
  repo UNINDEXED,
  path,
  heading,
  body,
  line_start UNINDEXED,
  tokenize = 'porter unicode61'
);
