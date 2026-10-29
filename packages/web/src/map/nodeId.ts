// Ids de nodo del mapa (los fija packages/api/src/topology.ts):
//   repo:<repo>   svc:<servicio>   ep:<clave del contrato>@<servicio>
//   code:<repo_id>   sym:<repo_id>|<tipo>|<nombre>   (grafo de código, bajo demanda)
// El resto de la UI (acciones de flujo, enlaces del agente) necesita saber a
// qué repo/servicio pertenece lo seleccionado sin volver a pedirlo al servidor.

export interface NodeContext {
  kind: 'repo' | 'service' | 'endpoint';
  /** Nombre del repo o del servicio (para un endpoint, el servicio que lo expone). */
  name: string;
}

export function nodeContext(id: string | null | undefined): NodeContext | null {
  if (!id) return null;
  if (id.startsWith('repo:')) return { kind: 'repo', name: id.slice(5) };
  if (id.startsWith('svc:')) return { kind: 'service', name: id.slice(4) };
  // Código: el repo es lo que sirve de contexto (p. ej. para evaluar un PR).
  if (id.startsWith('code:')) return { kind: 'repo', name: id.slice(5) };
  if (id.startsWith('sym:')) {
    const bar = id.indexOf('|');
    return bar > 4 ? { kind: 'repo', name: id.slice(4, bar) } : null;
  }
  if (id.startsWith('ep:')) {
    const at = id.lastIndexOf('@');
    return at > 3 ? { kind: 'endpoint', name: id.slice(at + 1) } : null;
  }
  return null;
}
