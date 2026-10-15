// Tests del despachante de investigación (G3): superficie de solo lectura,
// validación de schema, alcance del workspace, presupuesto y recorte con
// corte declarado.

import { describe, expect, it } from 'vitest';
import { createDispatcher, DISPATCHER_TOOLS } from '../src/agent/dispatcher.js';
import type { ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

function call(id: string, name: string, args: unknown): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

describe('LainDispatcher', () => {
  it('exposes only read tools and never a snapshot parameter', () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const specs = d.toolSpecs();
    expect(specs.map((s) => s.function.name).sort()).toEqual([...DISPATCHER_TOOLS].sort());
    // P07: no se amplían permisos — ninguna tool de escritura/publicación.
    const names = specs.map((s) => s.function.name);
    expect(names).not.toContain('publish');
    expect(names).not.toContain('write');
    for (const spec of specs) {
      const params = spec.function.parameters as { properties?: Record<string, unknown> };
      expect(params.properties?.snapshot).toBeUndefined();
    }
  });

  it('executes a valid call and injects the fixed view', async () => {
    const lain = createLainMock();
    const seen: Array<{ snapshot?: string }> = [];
    const spy: LainAdapter = {
      ...lain,
      async listServices(req) {
        seen.push(req);
        return lain.listServices(req);
      },
    };
    const d = createDispatcher({ lain: spy, view: 'live' });
    const r = await d.execute(call('t1', 'list_services', {}));
    expect(r.ok).toBe(true);
    expect(seen[0]?.snapshot).toBe('live');
    // El modelo no puede elegir la vista: snapshot en args es schema inválido.
    const r2 = await d.execute(call('t2', 'list_services', { snapshot: 'snap_deadbeef' }));
    expect(r2.ok).toBe(false);
    expect(r2.ok === false && r2.code).toBe('invalid_schema');
  });

  it('rejects an unknown tool with a typed error and keeps the tool set', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const r = await d.execute(call('t1', 'delete_repo', { repo: 'orders' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unknown_tool');
      expect(r.message).toContain('list_services');
    }
    // Las specs ofrecidas no cambian tras el rechazo.
    expect(d.toolSpecs().map((s) => s.function.name)).toEqual([...DISPATCHER_TOOLS]);
  });

  it('rejects invalid schema before touching LAIN', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const r = await d.execute(call('t1', 'get_service', { service: 42 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_schema');
    const bad = await d.execute(call('t2', 'get_service', '{not json'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('invalid_schema');
  });

  it('enforces workspace scope on services, repos and evidence refs', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const svc = await d.execute(call('t1', 'get_service', { service: 'not-a-service' }));
    expect(svc.ok).toBe(false);
    if (!svc.ok) expect(svc.code).toBe('scope_violation');

    const repo = await d.execute(
      call('t2', 'read_source', { repo: 'outside-repo', path: 'a.py', start: 0, end: 5 }),
    );
    expect(repo.ok).toBe(false);
    if (!repo.ok) expect(repo.code).toBe('scope_violation');

    const ev = await d.execute(
      call('t3', 'resolve_evidence', { refs: ['outside:Function:x.py:1'] }),
    );
    expect(ev.ok).toBe(false);
    if (!ev.ok) expect(ev.code).toBe('scope_violation');
  });

  it('accounts the budget and stops dispatching when exhausted', async () => {
    let lainCalls = 0;
    const base = createLainMock();
    const spy: LainAdapter = {
      ...base,
      async listServices(req) {
        lainCalls++;
        return base.listServices(req);
      },
    };
    const d = createDispatcher({ lain: spy, view: 'live', maxToolCalls: 2 });
    expect((await d.execute(call('t1', 'list_services', {}))).ok).toBe(true);
    expect((await d.execute(call('t2', 'list_services', {}))).ok).toBe(true);
    const r3 = await d.execute(call('t3', 'list_services', {}));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.code).toBe('budget_exhausted');
    // El catálogo de arranque no gasta presupuesto; sólo las llamadas del modelo.
    expect(d.budgetUse()).toEqual({ toolCallsUsed: 2, maxToolCalls: 2, exhausted: true });
    expect(lainCalls).toBe(3); // 1 catálogo + 2 del modelo
  });

  it('declares the cut when a result is too large (INV 3)', async () => {
    const base = createLainMock();
    const big: LainAdapter = {
      ...base,
      async listServices() {
        return {
          items: Array.from({ length: 200 }, (_, i) => ({
            service: `svc-${i}`,
            repo: 'orders',
            endpoints: 1,
            consumer_services: 0,
            unresolved_inbound: 0,
            paths: [`x${'y'.repeat(200)}`],
          })),
          scope: { configured_only: true, reviewed: [], unreviewed: ['reports'] },
        };
      },
    };
    const d = createDispatcher({ lain: big, view: 'live', maxResultChars: 2000 });
    const r = await d.execute(call('t1', 'list_services', {}));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).not.toBeNull();
      expect(r.truncated?.omittedChars).toBeGreaterThan(0);
      expect(r.truncated?.hint).toContain('narrower');
      // El corte se declara; no se presenta el resultado como completo.
      expect((r.data as { cut_declared?: unknown }).cut_declared ?? r.truncated).toBeTruthy();
    }
  });

  it('harvests delivered evidence ids from get_service anchors and resolve_evidence', async () => {
    const base = createLainMock();
    const rich: LainAdapter = {
      ...base,
      async getService(req) {
        const r = await base.getService(req);
        return {
          ...r,
          consumers: [
            {
              service: 'billing',
              repo: 'billing',
              uses: [
                {
                  binding: { confidence: 1, kind: 'static' },
                  fields: [],
                  site: {
                    id: 'billing:Function:src/main.py:fetch:35',
                    node_type: 'Function',
                    repo: 'billing',
                    path: 'src/main.py',
                    line: 35,
                  },
                },
              ],
            },
          ],
        };
      },
      async resolveEvidence(req) {
        return {
          items: req.refs.map((ref) => ({
            exists: ref.startsWith('billing:'),
            ref,
          })),
        };
      },
    };
    const d = createDispatcher({ lain: rich, view: 'live' });
    await d.execute(call('t1', 'get_service', { service: 'orders' }));
    await d.execute(
      call('t2', 'resolve_evidence', { refs: ['billing:Function:src/main.py:fetch:35'] }),
    );
    const delivered = d.deliveredEvidence();
    expect(delivered).toContain('billing:Function:src/main.py:fetch:35');
  });
});
