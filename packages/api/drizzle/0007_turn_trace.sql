-- La traza de la investigación que produjo el turno (herramientas, tokens, veredictos de las
-- afirmaciones): materia prima para medir y, más adelante, para elegir ejemplos de trabajo
-- entre las respuestas cuyas afirmaciones el motor verificó.
ALTER TABLE turn ADD COLUMN trace_json TEXT;
