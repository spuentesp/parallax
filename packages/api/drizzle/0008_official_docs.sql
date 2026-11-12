-- Documentación oficial por workspace: palabra clave de una librería -> dominios en los que
-- buscarla primero (web_search). Se siembra con los valores por defecto la primera vez que un
-- workspace la necesita; después la tabla es la única fuente de verdad y cada workspace añade o
-- quita lo suyo (p. ej. el sitio de documentación interno de una librería propia).
CREATE TABLE official_doc (
  workspace_id TEXT NOT NULL,
  word TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, word, domain)
);

-- Un workspace sembrado queda marcado: vaciar la lista a propósito no la vuelve a sembrar.
CREATE TABLE official_doc_seeded (
  workspace_id TEXT PRIMARY KEY,
  seeded_at INTEGER NOT NULL
);
