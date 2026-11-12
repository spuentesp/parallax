-- Lo que falta por publicar en GitHub de cada evaluación de un PR. Antes esto vivía sólo en una
-- suscripción en memoria: un reinicio la perdía y el PR se quedaba sin estado para siempre. Con la
-- fila, el arranque retoma lo pendiente y un fallo de GitHub se reintenta en vez de olvidarse.
CREATE TABLE pr_report (
  assessment_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  -- El contexto del estado: se desambigua por workspace cuando varios comparten el repo.
  context TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reported_at INTEGER
);
CREATE INDEX idx_pr_report_pending ON pr_report (reported_at);
