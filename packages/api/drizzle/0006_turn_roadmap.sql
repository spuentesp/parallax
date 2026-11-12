-- El recorrido (roadmap) o el radio de impacto que se dibujó bajo la respuesta
-- se guarda con el turno: al recargar la conversación se vuelve a dibujar.
ALTER TABLE turn ADD COLUMN artifact_json TEXT;
