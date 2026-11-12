-- Veredictos sobre cabos sueltos (llamadas sin resolver y relaciones inferidas).
-- Una fila por (workspace, caso): el juicio de Nemotron leyendo el código, con
-- el hash del fragmento que vio; si el código cambia, el hash cambia y el
-- veredicto se descarta. Las reglas por ruta no se guardan (son gratis).
CREATE TABLE loose_end_assessment (
  workspace_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  snippet_hash TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, case_id)
);
