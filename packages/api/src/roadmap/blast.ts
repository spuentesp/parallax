import type { OrgGraph } from '../org-graph.js';
import { ancestorsOf } from '../org-graph.js';
import { buildSeed } from '../trace/seed.js';

// Radio de impacto de un contrato, calculado SÓLO con lo que el motor registró:
// quién lo consume, desde qué código, con qué campos, y qué otros servicios dependen
// de esos consumidores (un segundo anillo). Nada del modelo.

export interface BlastConsumer {
  service: string;
  repo: string | null;
  uses: number;
  provenance: 'deterministic' | 'inferred';
  fields: string[];
  sites: Array<{ repo?: string; path: string; line?: number }>;
}
export interface BlastRipple {
  service: string;
  repo: string | null;
  /** Consumidor directo a través del que se llega hasta aquí. */
  via: string;
  uses: number;
}
export interface BlastRadius {
  key: string;
  service: string;
  repo: string | null;
  direct: BlastConsumer[];
  ripple: BlastRipple[];
  totalUses: number;
  caveats: string[];
}

export function blastRadius(graph: OrgGraph, key: string, service?: string): BlastRadius | null {
  const seed = buildSeed(graph, key, service);
  if (!seed) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const svcNode = (id: string) =>
    [id, ...ancestorsOf(id, byId)].map((a) => byId.get(a)).find((n) => n?.kind === 'service');
  const repoOf = (id: string): string | null => {
    const r = [id, ...ancestorsOf(id, byId)]
      .map((a) => byId.get(a))
      .find((n) => n?.kind === 'repo');
    return r ? (typeof r.meta.lainRepoId === 'string' ? r.meta.lainRepoId : r.label) : null;
  };
  const repoByService = new Map<string, string | null>();
  for (const n of graph.nodes) if (n.kind === 'service') repoByService.set(n.label, repoOf(n.id));

  const direct: BlastConsumer[] = seed.consumers.map((c) => ({
    service: c.service,
    repo: repoByService.get(c.service) ?? null,
    uses: c.uses,
    provenance: c.provenance,
    fields: c.fields,
    sites: c.sites.slice(0, 8),
  }));

  // Segundo anillo: servicios que consumen algo que PROVEEN los consumidores directos.
  const directNames = new Set([seed.service, ...direct.map((d) => d.service)]);
  const epOwner = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind !== 'endpoint') continue;
    const o = svcNode(n.id);
    if (o) epOwner.set(n.id, o.label);
  }
  const ripple = new Map<string, BlastRipple>();
  for (const e of graph.edges) {
    if (e.kind !== 'consumes') continue;
    const provider = epOwner.get(e.target);
    const from = svcNode(e.source)?.label;
    if (!provider || !from || !direct.some((d) => d.service === provider)) continue;
    if (directNames.has(from)) continue;
    const cur = ripple.get(from) ?? {
      service: from,
      repo: repoByService.get(from) ?? null,
      via: provider,
      uses: 0,
    };
    cur.uses += e.count;
    ripple.set(from, cur);
  }

  const caveats: string[] = [];
  if (direct.length === 0) {
    caveats.push(
      'No consumer of this contract was found in the indexed repositories. That does not prove nobody calls it: clients outside the workspace, or generated code the index does not contain, are invisible here.',
    );
  }
  const inferred = direct.filter((d) => d.provenance === 'inferred');
  if (inferred.length > 0) {
    caveats.push(
      `${inferred.map((d) => d.service).join(', ')} ${inferred.length === 1 ? 'is' : 'are'} linked by inference (a likely match, not a resolved call): treat as probable.`,
    );
  }
  return {
    key,
    service: seed.service,
    repo: seed.repo,
    direct,
    ripple: [...ripple.values()].sort((a, b) => b.uses - a.uses),
    totalUses: direct.reduce((n, d) => n + d.uses, 0),
    caveats,
  };
}

/** Prosa corta y verificable de un radio de impacto: sólo cifras del motor. */
export function blastSentence(b: BlastRadius): string {
  if (b.direct.length === 0) {
    return `Changing ${b.key} (${b.service}) has no known consumer in the indexed repositories.`;
  }
  const parts = b.direct.map(
    (d) =>
      `${d.service}${d.repo && d.repo !== d.service ? ` (${d.repo})` : ''} — ${d.uses} ${d.uses === 1 ? 'use' : 'uses'}${d.provenance === 'inferred' ? ', inferred' : ''}`,
  );
  const ring =
    b.ripple.length > 0
      ? ` Second ring: ${b.ripple.map((r) => `${r.service} (via ${r.via})`).join(', ')}.`
      : '';
  return `Changing ${b.key} (${b.service}) directly affects ${b.direct.length} ${b.direct.length === 1 ? 'service' : 'services'} and ${b.totalUses} call ${b.totalUses === 1 ? 'site' : 'sites'}: ${parts.join('; ')}.${ring}`;
}
