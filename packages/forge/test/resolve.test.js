// Tests for turning ticket text into expected impact. Parallax itself is replaced by
// plain functions at the edge; the data below is shaped like real graph responses.
import { describe, expect, it } from 'vitest';
import { expectedImpact, extractTerms, matchServiceNames, toGraph } from '../src/resolve.js';

describe('extractTerms', () => {
  it('finds CamelCase methods and kebab-case service names in a real ticket', () => {
    const text =
      'Add an optional labels map to rpc openshell.v1.OpenShell/CreateSandbox in the openshell-gateway service.';
    const terms = extractTerms(text);
    expect(terms).toContain('CreateSandbox');
    expect(terms).toContain('openshell-gateway');
  });

  it('reads the method name out of a full contract key', () => {
    expect(extractTerms('breaks rpc:openshell.v1.OpenShell/ListSandboxes today')).toContain(
      'ListSandboxes',
    );
  });

  it('finds HTTP routes', () => {
    const terms = extractTerms('Support streaming on POST /v1/chat/completions in nemo-fabric');
    // the method stays attached, so GET and POST on one path are not confused
    expect(terms).toContain('POST /v1/chat/completions');
    expect(terms).toContain('nemo-fabric');
  });

  it('ignores identifiers that only appear inside a link', () => {
    // Regression: "OpenShell" in github.com/NVIDIA/OpenShell/pull/1 was read as a ticket term.
    expect(extractTerms('Improve sessions. https://github.com/NVIDIA/OpenShell/pull/5052')).toEqual(
      [],
    );
    expect(extractTerms('Change CreateSandbox, see https://example.com/NemoClaw/x')).toEqual([
      'CreateSandbox',
    ]);
  });

  it('does not match a service name that appears only inside a link', async () => {
    const out = await expectedImpact({
      text: 'See https://github.com/org/nemoclaw/pull/1',
      workspaces: [{ id: 'w', name: 'W' }],
      briefing: async () => ({ briefing: { repos: [{ services: [{ name: 'nemoclaw' }] }] } }),
      search: async () => [],
      impact: async () => ({ error: 'unexpected lookup' }),
    });
    expect(out.targets).toEqual([]);
  });

  it('ignores ordinary prose, short words and known false friends', () => {
    expect(extractTerms('fix the follow-up and the read-only thing, ok')).toEqual([]);
    expect(extractTerms('')).toEqual([]);
    expect(extractTerms(undefined)).toEqual([]);
  });

  it('does not repeat a term that appears twice or in another case', () => {
    expect(extractTerms('CreateSandbox then createsandbox then CreateSandbox')).toEqual([
      'CreateSandbox',
    ]);
  });

  it('caps how many terms it returns', () => {
    const many = Array.from(
      { length: 40 },
      (_, i) => `DoThing${String.fromCharCode(65 + (i % 26))}Now${i}`,
    );
    expect(extractTerms(many.join(' ')).length).toBeLessThanOrEqual(10);
  });
});

describe('matchServiceNames', () => {
  const names = ['nemoclaw', 'openshell-gateway', 'nat', 'nat-ui'];

  it('matches whole words regardless of case', () => {
    expect(matchServiceNames('The NemoClaw adapter reads providers', names)).toEqual(['nemoclaw']);
  });
  it('does not match inside longer names or hyphenated variants', () => {
    expect(matchServiceNames('nemoclawed and nemoclaw-ui', names)).toEqual([]);
    expect(matchServiceNames('the openshell-gateway-extra thing', names)).toEqual([]);
  });
  it('ignores very short service names that would match ordinary words', () => {
    expect(matchServiceNames('the nat table', names)).toEqual([]);
  });
});

// A tiny world shaped like cluster A.
const WS = [{ id: 'ws_a', name: 'Cluster A' }];
const hit = (label, service, bound = 0) => ({
  nodeId: `ep:${label}@${service}`,
  label,
  kind: 'endpoint',
  service,
  boundConsumers: bound,
});
const SEARCH = {
  CreateSandbox: [
    hit('rpc:openshell.compute.v1.ComputeDriver/CreateSandbox', 'openshell-gateway', 0),
    hit('rpc:openshell.v1.OpenShell/CreateSandbox', 'openshell-gateway', 2),
    hit('rpc:openshell.v1.OpenShell/CreateSandboxTemplate', 'openshell-gateway', 1),
  ],
};
const consumer = (service, provenance = 'deterministic', usages = 2, annotations) => ({
  service,
  repo: 'R',
  provenance,
  usages,
  ...(annotations ? { annotations } : {}),
});
const IMPACT = {
  'ep:rpc:openshell.compute.v1.ComputeDriver/CreateSandbox@openshell-gateway': {
    node: { nodeId: 'ep:compute', label: 'rpc:...ComputeDriver/CreateSandbox', kind: 'endpoint' },
    consumers: [],
  },
  'ep:rpc:openshell.v1.OpenShell/CreateSandbox@openshell-gateway': {
    node: { nodeId: 'ep:v1', label: 'rpc:openshell.v1.OpenShell/CreateSandbox', kind: 'endpoint' },
    consumers: [consumer('openshell-sdk')],
  },
  'svc:nemoclaw': {
    node: { nodeId: 'svc:nemoclaw', label: 'nemoclaw', kind: 'service' },
    consumers: [
      consumer('nemo-fabric', 'inferred', 43),
      consumer('web', 'deterministic', 5, { owner: 'Platform team', criticality: 'High' }),
    ],
  },
};
const deps = (over = {}) => ({
  workspaces: WS,
  briefing: async () => ({
    briefing: { repos: [{ services: [{ name: 'nemoclaw' }, { name: 'openshell-gateway' }] }] },
  }),
  search: async (_ws, term) => SEARCH[term] ?? [],
  impact: async (_ws, id) => IMPACT[id] ?? { error: 'not found' },
  ...over,
});

describe('expectedImpact', () => {
  it('resolves an endpoint name to its exact consumers', async () => {
    const out = await expectedImpact({ text: 'Add labels to CreateSandbox', ...deps() });

    expect(out.terms).toEqual(['CreateSandbox']);
    // both endpoints named CreateSandbox are exact matches; the *Template one is not
    expect(out.targets.map((t) => t.matched)).toEqual(['exact', 'exact']);
    expect(out.targets.some((t) => t.node.nodeId === 'ep:v1')).toBe(true);
    expect(out.summary).toEqual({ targets: 2, consumers: 1, provenByCode: 1, inferredOnly: 0 });
    expect(out.unmatchedTerms).toEqual([]);
  });

  it('matches a service by name without any identifier-looking word', async () => {
    const out = await expectedImpact({ text: 'Bug in the NemoClaw adapter', ...deps() });
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0]).toMatchObject({ matched: 'exact', term: 'nemoclaw' });
    // one consumer is only inferred, one is proven; the summary keeps them apart
    expect(out.summary).toMatchObject({ consumers: 2, provenByCode: 1, inferredOnly: 1 });
  });

  it('falls back to fuzzy hits when nothing matches exactly, and says so', async () => {
    const out = await expectedImpact({
      text: 'Touch the GetThing thing',
      ...deps({ search: async () => [hit('rpc:x.v1.X/GetThingsList', 'openshell-gateway')] }),
      impact: async () => ({
        node: { nodeId: 'ep:fuzzy', label: 'rpc:x.v1.X/GetThingsList', kind: 'endpoint' },
        consumers: [],
      }),
    });
    expect(out.targets[0].matched).toBe('fuzzy');
  });

  it('lists terms it could not place instead of dropping them silently', async () => {
    const out = await expectedImpact({
      text: 'Rework the FrobnicateWidget logic',
      ...deps({ search: async () => [] }),
    });
    expect(out.targets).toEqual([]);
    expect(out.unmatchedTerms).toEqual(['FrobnicateWidget']);
  });

  it('counts a node once even when both a name and an identifier find it', async () => {
    const out = await expectedImpact({
      text: 'nemoclaw: fix nemoclaw',
      ...deps({
        search: async () => [{ nodeId: 'svc:nemoclaw', label: 'nemoclaw', kind: 'service' }],
      }),
    });
    expect(out.targets).toHaveLength(1);
  });

  it('skips a target whose impact lookup fails and keeps the rest', async () => {
    const out = await expectedImpact({ text: 'CreateSandbox in nemoclaw', ...deps() });
    // compute-driver endpoint resolves (no consumers); nemoclaw resolves; v1 resolves
    expect(out.targets.length).toBeGreaterThanOrEqual(2);
    const broken = await expectedImpact({
      text: 'CreateSandbox',
      ...deps({ impact: async () => ({ error: 'engine unavailable' }) }),
    });
    expect(broken.targets).toEqual([]);
  });

  it('lets an exact hit win over a loose hit that found the same node first', async () => {
    // Regression: a hit for "ComputeDriver" used to claim AuthenticateSandbox as "fuzzy",
    // so the exact match for "AuthenticateSandbox" was dropped as already seen.
    const auth = hit('rpc:openshell.compute.v1.ComputeDriver/AuthenticateSandbox', 'gw');
    const other = hit('rpc:openshell.compute.v1.ComputeDriver/CreateSandbox', 'gw');
    const out = await expectedImpact({
      text: 'ComputeDriver AuthenticateSandbox change',
      ...deps({
        search: async (_ws, term) => (term === 'ComputeDriver' ? [auth, other] : [auth]),
        impact: async (_ws, id) => ({
          node: { nodeId: id, label: id, kind: 'endpoint' },
          consumers: [],
        }),
      }),
    });
    expect(out.targets.map((t) => [t.node.nodeId, t.matched])).toEqual([[auth.nodeId, 'exact']]);
    expect(out.unmatchedTerms).toEqual(['ComputeDriver']);
  });

  it('drops loose hits whenever something matched exactly', async () => {
    const out = await expectedImpact({
      text: 'CreateSandbox and ComputeDriver',
      ...deps({
        search: async (_ws, term) =>
          term === 'ComputeDriver'
            ? [hit('rpc:x.v1.ComputeDriver/Other', 'gw')]
            : [hit('rpc:openshell.v1.OpenShell/CreateSandbox', 'gw', 2)],
        impact: async (_ws, id) => ({
          node: { nodeId: id, label: id, kind: 'endpoint' },
          consumers: [],
        }),
      }),
    });
    expect(out.targets.every((t) => t.matched === 'exact')).toBe(true);
    expect(out.targets).toHaveLength(1);
  });

  it('matches an HTTP route by method as well as path', async () => {
    const routes = [
      hit('http:GET /v1/chat/completions', 'f'),
      hit('http:POST /v1/chat/completions', 'f'),
    ];
    const seen = [];
    const out = await expectedImpact({
      text: 'Stream POST /v1/chat/completions',
      ...deps({
        search: async (_ws, term) => {
          seen.push(term);
          return routes;
        },
        impact: async (_ws, id) => ({
          node: { nodeId: id, label: id, kind: 'endpoint' },
          consumers: [],
        }),
      }),
    });
    expect(seen).toContain('/v1/chat/completions'); // searched by path
    expect(out.targets.map((t) => t.node.nodeId)).toEqual(['ep:http:POST /v1/chat/completions@f']);
  });

  it('puts precise endpoint answers before whole-service answers', async () => {
    const out = await expectedImpact({ text: 'nemoclaw uses CreateSandbox', ...deps() });
    const kinds = out.targets.map((t) => t.node.kind);
    expect(kinds.indexOf('endpoint')).toBeLessThan(kinds.indexOf('service'));
  });

  it('keeps going when a workspace briefing fails', async () => {
    const out = await expectedImpact({
      text: 'CreateSandbox',
      ...deps({
        briefing: async () => {
          throw new Error('boom');
        },
      }),
    });
    expect(out.targets.length).toBeGreaterThan(0);
  });

  it('returns an empty, well-formed answer for text with nothing in it', async () => {
    const out = await expectedImpact({ text: 'Update the docs', ...deps() });
    expect(out).toMatchObject({
      terms: [],
      targets: [],
      summary: { targets: 0, consumers: 0, provenByCode: 0, inferredOnly: 0 },
      graph: { nodes: [], edges: [] },
    });
  });
});

describe('toGraph', () => {
  it('draws consumers pointing at targets and carries owner and criticality', () => {
    const graph = toGraph([
      {
        workspaceId: 'ws_a',
        node: { nodeId: 'svc:gw', label: 'gw', kind: 'service' },
        consumers: [
          consumer('web', 'inferred', 9, { owner: 'Platform team', criticality: 'High' }),
        ],
      },
    ]);
    expect(graph.nodes.map((n) => n.kind).sort()).toEqual(['consumer', 'target']);
    const web = graph.nodes.find((n) => n.label === 'web');
    expect(web).toMatchObject({ detail: 'Platform team', criticality: 'High' });
    expect(graph.edges).toEqual([
      { from: 'service:ws_a:web', to: 'target:ws_a:svc:gw', provenance: 'inferred', usages: 9 },
    ]);
  });

  it('shares one consumer node between two targets', () => {
    const t = (id) => ({
      workspaceId: 'ws_a',
      node: { nodeId: id, label: id, kind: 'service' },
      consumers: [consumer('web')],
    });
    const graph = toGraph([t('svc:a'), t('svc:b')]);
    expect(graph.nodes.filter((n) => n.kind === 'consumer')).toHaveLength(1);
    expect(graph.edges).toHaveLength(2);
  });
});
