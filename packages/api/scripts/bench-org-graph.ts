// Banco de pruebas de rendimiento del grafo del mapa: mide el coste de
// proyectar y describir un grafo de tamaño realista. No forma parte del
// producto; sirve para comprobar que las optimizaciones afectan a lo que
// dicen afectar.
import { describeNode, type OrgGraph, projectOrgGraph } from '../src/org-graph.js';
import { viewOrgGraph } from '../src/org-graph-view.js';

function makeGraph(repos: number, services: number, endpoints: number): OrgGraph {
  const nodes: OrgGraph['nodes'] = [];
  const edges: OrgGraph['edges'] = [];
  const epIds: string[] = [];
  for (let r = 0; r < repos; r++) {
    const repoId = `repo:${r}`;
    nodes.push({ id: repoId, label: `repo-${r}`, kind: 'repo', parent: null, meta: {} });
    for (let s = 0; s < services; s++) {
      const svcId = `svc:${r}:${s}`;
      nodes.push({
        id: svcId,
        label: `service-${r}-${s}`,
        kind: 'service',
        parent: repoId,
        meta: {},
      });
      for (let e = 0; e < endpoints; e++) {
        const epId = `ep:${r}:${s}:${e}`;
        nodes.push({
          id: epId,
          label: `GET /api/thing-${r}-${s}-${e}`,
          kind: 'endpoint',
          parent: svcId,
          contract: 'http',
          meta: {},
        });
        epIds.push(epId);
      }
    }
  }
  for (let i = 0; i < epIds.length; i++) {
    const target = epIds[(i * 7 + 3) % epIds.length] as string;
    edges.push({
      id: `consumes:${epIds[i]}->${target}`,
      source: epIds[i] as string,
      target,
      kind: 'consumes',
      provenance: 'deterministic',
      confidence: 1,
      count: 1,
      deterministicCount: 1,
      inferredCount: 0,
    });
  }
  return { nodes, edges };
}

const graph = makeGraph(40, 6, 20);
console.log(
  `grafo: ${graph.nodes.length} nodos, ${graph.edges.length} aristas`,
);

const expanded = new Set<string>();
for (const n of graph.nodes) if (n.kind === 'repo') expanded.add(n.id);

function time(label: string, runs: number, fn: () => void): void {
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  console.log(`${label}: ${ms.toFixed(2)} ms/iteración`);
}

time('projectOrgGraph (todo abierto)', 20, () => {
  projectOrgGraph(graph, expanded);
});

time('viewOrgGraph (proyección + foco)', 20, () => {
  viewOrgGraph(graph, { expand: [...expanded], focus: 'svc:1:1', hops: 2 });
});

time('describeNode (detalle de endpoint)', 50, () => {
  describeNode(graph, 'ep:1:1:1');
});
