import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

/**
 * Borde de proceso único para los tests del web: aquí se intercepta la RED,
 * nunca se mockean hooks o stores internos (regla AGENTS.md #2 — un mock
 * interno es exactamente cómo se esconde el feature isolation). Un request sin
 * handler es un error del test (`onUnhandledRequest: 'error'`).
 */

export const sampleReport = {
  id: 'a_1',
  orgId: 'ws_fixture',
  inputDigest: 'sha256_abc',
  status: 'PARTIAL',
  baseId: 'snap_base',
  headId: 'snap_head',
  manifest: {},
  findings: [
    {
      kind: 'FieldRemoved',
      field: 'customer_id',
      service: 'orders',
      endpoint: { key: 'http:GET /api/orders/{}' },
      impact: { class: 'Verified' },
      affected: [{ service: 'billing', class: 'Verified' }],
    },
  ],
  engine: {},
  coverage: {
    complete: false,
    summary:
      'revisados: orders, billing · no revisados: reports (excluded) · la cobertura está incompleta: un resultado vacío no autoriza a concluir ausencia de impacto',
    scope: {
      reviewed: ['orders', 'billing'],
      unreviewed: [{ repo: 'reports', reason: 'excluded' }],
      excluded: [],
    },
  },
  evidence: [],
  explanation: { status: 'skipped', revision: 0, model: 'none' },
  createdAt: 1,
  completedAt: 2,
};

export const handlers = [
  http.get('/api/whoami', () =>
    HttpResponse.json({ orgId: 'acme', scopes: ['read', 'write'], readOnly: false }),
  ),
  http.get('/api/orgs', () => HttpResponse.json({ orgs: [{ id: 'acme', name: 'Acme Corp' }] })),
  http.get('/api/assessments', () => HttpResponse.json({ assessments: [] })),
  http.get('/api/assessments/:id', ({ params }) =>
    HttpResponse.json({ assessment: { ...sampleReport, id: String(params.id) } }),
  ),
  http.post('/api/assessments', () =>
    HttpResponse.json({ assessment: sampleReport, created: true }),
  ),
  http.get('/api/workspaces', () => HttpResponse.json({ workspaces: [] })),
  http.get('/api/workspaces/:id', ({ params }) =>
    HttpResponse.json({
      workspace: { id: String(params.id), name: 'Demo', lainUrl: null, repos: [] },
    }),
  ),
  http.get('/api/workspaces/:id/repos', () => HttpResponse.json({ repos: [] })),
  http.get('/api/workspaces/:id/repos/status', () =>
    HttpResponse.json({ source: 'unconfigured', repos: [], untracked: [] }),
  ),
  http.get('/api/workspaces/:id/topology', () =>
    HttpResponse.json({ topology: { nodes: [], edges: [] }, source: 'mock' }),
  ),
  http.get('/api/workspaces/:id/graph', () => HttpResponse.json({ roots: [] })),
  http.get('/api/workspaces/:id/graph/children', () => HttpResponse.json({ children: [] })),
  http.get('/api/workspaces/:id/graph/snippet', () => HttpResponse.json({ text: null })),
  http.post('/api/workspaces/:id/map/view', () =>
    HttpResponse.json({
      nodes: [],
      edges: [],
      hiddenChildren: {},
      focus: null,
      unknownExpand: [],
      meta: { source: 'unconfigured' },
    }),
  ),
  http.get('/api/workspaces/:id/map/node', () =>
    HttpResponse.json({ detail: null, meta: { source: 'unconfigured' } }),
  ),
  http.get('/api/workspaces/:id/map/search', () =>
    HttpResponse.json({ results: [], meta: { source: 'unconfigured' } }),
  ),
  http.post('/api/workspaces/:id/evidence', () => HttpResponse.json({ items: [], source: 'mock' })),
];

export const server = setupServer(...handlers);
