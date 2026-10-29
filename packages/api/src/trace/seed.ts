import type { OrgGraph } from '../org-graph.js';
import { ancestorsOf } from '../org-graph.js';
import type { TraceSeed } from './schema.js';

/**
 * Lo que el MOTOR ya sabe de un contrato: dónde se define y desde qué sitios de
 * código de otros servicios se llama. Es el centro del trazado; el modelo lo
 * extiende hacia el dato y hacia el destino del valor.
 */
export function buildSeed(graph: OrgGraph, key: string, service?: string): TraceSeed | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const owner = (id: string) => {
    for (const a of [id, ...ancestorsOf(id, byId)]) {
      const n = byId.get(a);
      if (n?.kind === 'service') return n;
    }
    return undefined;
  };
  const candidates = graph.nodes.filter(
    (n) => n.kind === 'endpoint' && n.label === key && (!service || owner(n.id)?.label === service),
  );
  const ep = candidates[0];
  if (!ep) return null;
  const svc = owner(ep.id);
  const repoNode = [...ancestorsOf(ep.id, byId)]
    .map((a) => byId.get(a))
    .find((n) => n?.kind === 'repo');

  const providers = Array.isArray(ep.meta.providers)
    ? (ep.meta.providers as Array<{ repo?: string; path?: string; line?: number }>).slice(0, 4)
    : [];

  const consumers = new Map<string, TraceSeed['consumers'][number]>();
  for (const e of graph.edges) {
    if (e.kind !== 'consumes' || e.target !== ep.id) continue;
    const from = owner(e.source);
    const name = from?.label ?? e.source;
    const cur = consumers.get(name) ?? {
      service: name,
      uses: 0,
      provenance: 'inferred' as const,
      fields: [],
      sites: [],
    };
    cur.uses += e.count;
    if (e.deterministicCount > 0) cur.provenance = 'deterministic';
    for (const f of e.fields ?? []) if (!cur.fields.includes(f)) cur.fields.push(f);
    for (const s of e.sites ?? []) {
      if (!cur.sites.some((x) => x.path === s.path && x.line === s.line)) cur.sites.push(s);
    }
    consumers.set(name, cur);
  }

  return {
    key,
    service: svc?.label ?? '',
    repo:
      typeof repoNode?.meta.lainRepoId === 'string'
        ? repoNode.meta.lainRepoId
        : (repoNode?.label ?? null),
    providers,
    consumers: [...consumers.values()].sort((a, b) => b.uses - a.uses),
  };
}
