// Orientación (capítulos 1 y 3 del onboarding): qué hay, cómo se divide, cuáles
// son las "puertas" (contratos por tipo) y quién usa qué. Sin modelo: es una
// función pura sobre el MISMO grafo cacheado que dibuja el mapa, así que cada
// número se puede rastrear hasta él. Lo que no se sabe (repos sin LAIN) se dice.

import type { OrgGraph } from '../org-graph.js';
import { ancestorsOf } from '../org-graph.js';

export interface BriefingGroup {
  key: string;
  label: string;
  count: number;
  note?: string;
}

export interface BriefingService {
  id: string;
  name: string;
  contracts: number;
  groups: BriefingGroup[];
}

export interface BriefingRepo {
  id: string;
  name: string;
  /** repo_id de LAIN con el que se navega su código; null = el código no es navegable. */
  lainRepoId: string | null;
  services: BriefingService[];
}

export interface BriefingRelation {
  from: string;
  to: string;
  /** Usos agregados (suma de las relaciones concretas). */
  uses: number;
  deterministic: number;
  inferred: number;
  /** Operaciones/endpoints distintos del proveedor que se usan. */
  contractsUsed: number;
}

export interface BriefingHub {
  service: string;
  repo: string | null;
  consumerServices: number;
  uses: number;
}

export interface BriefingOperation {
  key: string;
  service: string;
  group: string | null;
  uses: number;
  consumers: number;
}

export interface Briefing {
  totals: { repos: number; services: number; contracts: number; relations: number };
  repos: BriefingRepo[];
  relations: BriefingRelation[];
  hubs: BriefingHub[];
  topOperations: BriefingOperation[];
  /** Lo que el mapa NO puede mostrar: se dice, nunca se omite. */
  gaps: Array<{ repo: string; reason: string }>;
}

const TOP_OPERATIONS = 8;

export function buildBriefing(graph: OrgGraph): Briefing {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const serviceOf = (id: string): string | null => {
    for (const c of [id, ...ancestorsOf(id, byId)]) if (byId.get(c)?.kind === 'service') return c;
    return null;
  };

  const repos: BriefingRepo[] = graph.nodes
    .filter((n) => n.kind === 'repo')
    .map((r) => ({
      id: r.id,
      name: r.label,
      lainRepoId: typeof r.meta.lainRepoId === 'string' ? r.meta.lainRepoId : null,
      services: graph.nodes
        .filter((s) => s.kind === 'service' && ancestorsOf(s.id, byId).includes(r.id))
        .map((s) => {
          const groups = graph.nodes
            .filter((g) => g.kind === 'group' && g.parent === s.id)
            .map((g) => ({
              key: String(g.meta.group ?? g.id),
              label: g.label,
              count: typeof g.meta.contracts === 'number' ? g.meta.contracts : 0,
              ...(typeof g.meta.note === 'string' ? { note: g.meta.note } : {}),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
          return {
            id: s.id,
            name: s.label,
            contracts: groups.reduce((n, g) => n + g.count, 0),
            groups,
          };
        })
        .sort((a, b) => b.contracts - a.contracts || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Servicio → servicio, sumando los usos de cada relación concreta.
  const rel = new Map<string, BriefingRelation & { eps: Set<string> }>();
  const opUse = new Map<string, { uses: number; consumers: Set<string> }>();
  for (const e of graph.edges) {
    if (e.kind !== 'consumes') continue;
    const from = serviceOf(e.source);
    const to = serviceOf(e.target);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const cur = rel.get(key) ?? {
      from: byId.get(from)?.label ?? from,
      to: byId.get(to)?.label ?? to,
      uses: 0,
      deterministic: 0,
      inferred: 0,
      contractsUsed: 0,
      eps: new Set<string>(),
    };
    cur.uses += e.count;
    cur.deterministic += e.deterministicCount;
    cur.inferred += e.inferredCount;
    cur.eps.add(e.target);
    rel.set(key, cur);
    const op = opUse.get(e.target) ?? { uses: 0, consumers: new Set<string>() };
    op.uses += e.count;
    op.consumers.add(from);
    opUse.set(e.target, op);
  }
  const relations: BriefingRelation[] = [...rel.values()]
    .map(({ eps, ...r }) => ({ ...r, contractsUsed: eps.size }))
    .sort((a, b) => b.uses - a.uses || a.from.localeCompare(b.from));

  const hubMap = new Map<string, { consumers: Set<string>; uses: number }>();
  for (const r of relations) {
    const h = hubMap.get(r.to) ?? { consumers: new Set<string>(), uses: 0 };
    h.consumers.add(r.from);
    h.uses += r.uses;
    hubMap.set(r.to, h);
  }
  const repoOfService = new Map(
    repos.flatMap((r) => r.services.map((s) => [s.name, r.name] as const)),
  );
  const hubs: BriefingHub[] = [...hubMap.entries()]
    .map(([service, h]) => ({
      service,
      repo: repoOfService.get(service) ?? null,
      consumerServices: h.consumers.size,
      uses: h.uses,
    }))
    .sort((a, b) => b.uses - a.uses || a.service.localeCompare(b.service));

  const topOperations: BriefingOperation[] = [...opUse.entries()]
    .map(([id, u]) => {
      const n = byId.get(id);
      const group = n?.parent ? byId.get(n.parent) : null;
      return {
        key: n?.label ?? id,
        service: byId.get(serviceOf(id) ?? '')?.label ?? '',
        group: group?.kind === 'group' ? group.label : null,
        uses: u.uses,
        consumers: u.consumers.size,
      };
    })
    .sort((a, b) => b.uses - a.uses || a.key.localeCompare(b.key))
    .slice(0, TOP_OPERATIONS);

  return {
    totals: {
      repos: repos.length,
      services: repos.reduce((n, r) => n + r.services.length, 0),
      contracts: repos.reduce((n, r) => n + r.services.reduce((m, s) => m + s.contracts, 0), 0),
      relations: relations.length,
    },
    repos,
    relations,
    hubs,
    topOperations,
    gaps: repos
      .filter((r) => r.lainRepoId === null)
      .map((r) => ({
        repo: r.name,
        reason:
          'its code is not in the engine index (the repository name does not match a configured one), so its code cannot be browsed',
      })),
  };
}
