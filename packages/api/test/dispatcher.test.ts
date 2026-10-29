// Tests del despachante de investigación (G3): superficie de solo lectura,
// validación de schema, alcance del workspace, presupuesto y recorte con
// corte declarado.

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, createDispatcher, summarizeConsumers } from '../src/agent/dispatcher.js';
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
    // web_search sólo existe cuando se configura la búsqueda web (Tavily).
    expect(specs.map((s) => s.function.name).sort()).toEqual(
      ALL_TOOLS.filter((t) => t !== 'web_search').sort(),
    );
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
    expect(d.toolSpecs().map((s) => s.function.name)).toEqual(
      ALL_TOOLS.filter((t) => t !== 'web_search'),
    );
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
    expect((await d.execute(call('t2', 'list_contracts', {}))).ok).toBe(true);
    const r3 = await d.execute(call('t3', 'list_unresolved', {}));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.code).toBe('budget_exhausted');
    // El catálogo de arranque no gasta presupuesto; sólo las llamadas del modelo.
    expect(d.budgetUse()).toEqual({
      toolCallsUsed: 2,
      maxToolCalls: 2,
      exhausted: true,
      cutShort: true,
    });
    expect(lainCalls).toBe(2); // 1 catálogo + 1 list_services del modelo (la otra lectura fue list_contracts)
  });

  it('only flags the research as cut short once a read was actually refused', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxToolCalls: 1 });
    expect((await d.execute(call('t1', 'list_services', {}))).ok).toBe(true);
    // Gastó todo el tope pero nada quedó sin leer: agotado, no recortado.
    expect(d.budgetUse()).toMatchObject({ exhausted: true, cutShort: false });
    expect((await d.execute(call('t2', 'list_services', {}))).ok).toBe(false);
    expect(d.budgetUse()).toMatchObject({ exhausted: true, cutShort: true });
  });

  it('does not charge the budget for a read the engine failed', async () => {
    const base = createLainMock();
    const failing: LainAdapter = {
      ...base,
      async getContract() {
        throw new Error('contract not found');
      },
    };
    const d = createDispatcher({ lain: failing, view: 'live', maxToolCalls: 2 });
    const bad = await d.execute(call('t1', 'get_contract', { service: 'billing', key: 'nope' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('engine_error');
    expect(d.budgetUse()).toMatchObject({ toolCallsUsed: 0, cutShort: false });
    expect((await d.execute(call('t2', 'list_services', {}))).ok).toBe(true);
    expect(d.budgetUse().toolCallsUsed).toBe(1);
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

  it('a text result is cut by lines and says which lines are left', async () => {
    const base = createLainMock();
    const body = Array.from(
      { length: 400 },
      (_, i) => `   ${100 + i}: line ${i} ${'x'.repeat(40)}`,
    );
    const withText: LainAdapter = {
      ...base,
      async codeTool() {
        return { text: `File: x\nShowing lines 100-499\n\n${body.join('\n')}` };
      },
    };
    const d = createDispatcher({ lain: withText, view: 'live', maxResultChars: 2000 });
    const r = await d.execute(call('t1', 'get_code_snippet', { repo: 'orders', path: 'a.py' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // El resultado conserva su forma: el modelo lee texto, no un JSON roto.
    const data = r.data as { text: string };
    expect(typeof data.text).toBe('string');
    expect(data.text).toContain('line 0');
    // Y el pie dice el rango que se ve y el que queda.
    expect(data.text).toMatch(/\[truncated: showing lines 100-\d+ of 499\./);
    expect(data.text).toMatch(/lines \d+-499 were not shown/);
    expect(data.text).toMatch(/read_source\(repo, path, start, end\)/);
    // Los números del corte son exactos, no una estimación.
    expect(r.truncated?.lines?.kept).toBeGreaterThan(0);
    expect(r.truncated?.lines?.total).toBe(403);
    expect(r.truncated?.lines?.shownFrom).toBe(100);
    expect(r.truncated?.lines?.remainingTo).toBe(499);
  });

  it('the duplicate refusal names the receipt of the first call', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxToolCalls: 5 });
    const first = await d.execute(call('a', 'search_code', { query: 'checkout' }));
    const again = await d.execute(call('b', 'search_code', { query: 'checkout' }));
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: false, code: 'duplicate_call' });
    if (first.ok && !again.ok) {
      // El recibo de la primera es el que se puede citar: el modelo no tiene
      // que volver a pagar la lectura.
      expect(again.message).toContain(first.receipt);
      expect(d.hasReceipt(first.receipt)).toBe(true);
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

  it('consumers_of summarizes consumers with a citable id and counts only delivered ids as evidence', async () => {
    const base = createLainMock();
    const lain: LainAdapter = {
      ...base,
      async getService(req) {
        const r = await base.getService(req);
        return {
          ...r,
          consumers: [
            {
              service: 'web',
              repo: 'web-repo',
              uses: [
                {
                  binding: { confidence: 1, kind: 'static' },
                  fields: [],
                  endpoint: { service: r.service, key: 'graphql:query:product' },
                  site: { id: 'web-repo:Function:src/a.ts:call:3' },
                },
                {
                  binding: { confidence: 1, kind: 'static' },
                  fields: [],
                  endpoint: { service: r.service, key: 'graphql:query:product' },
                  site: { id: 'web-repo:Function:src/b.ts:call:9' },
                },
              ],
            },
          ],
        };
      },
    };
    const d = createDispatcher({ lain, view: 'live' });
    const services = await lain.listServices({ snapshot: 'live' });
    const name = services.items[0]?.service as string;
    const r = await d.execute(call('t1', 'consumers_of', { service: name }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as {
        consumers: Array<{ uses: number; endpoints: Array<{ evidence_id: string }> }>;
      };
      expect(data.consumers[0]?.uses).toBe(2);
      expect(data.consumers[0]?.endpoints[0]?.evidence_id).toBe(
        'web-repo:Function:src/a.ts:call:3',
      );
    }
    // El id entregado por el resumen es citable; uno que no se entregó no.
    expect(d.deliveredEvidence()).toContain('web-repo:Function:src/a.ts:call:3');
    expect(d.deliveredEvidence()).not.toContain('web-repo:Function:src/b.ts:call:9');
  });

  it('consumers_of respects the workspace scope', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const r = await d.execute(call('t1', 'consumers_of', { service: 'not-in-the-view' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('scope_violation');
  });

  it('workspaceMap lists the catalog services with the engine counts', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    const map = await d.workspaceMap();
    expect(map.length).toBeGreaterThan(0);
    expect(map).toMatch(/endpoints, consumed by \d+ service\(s\)/);
  });
});

describe('query receipts', () => {
  it('mints one receipt per answered read and none for rejected ones', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxToolCalls: 5 });
    const a = await d.execute(call('t1', 'list_services', {}));
    await d.execute(call('t2', 'get_service', { service: 'not-in-the-view' }));
    const b = await d.execute(call('t3', 'get_service', { service: 'orders' }));
    expect(a.ok && a.receipt).toBe('q:1');
    expect(b.ok && b.receipt).toBe('q:2');
    expect(d.receipts().map((r) => [r.id, r.tool])).toEqual([
      ['q:1', 'list_services'],
      ['q:2', 'get_service'],
    ]);
    expect(d.hasReceipt('q:2')).toBe(true);
    expect(d.hasReceipt('q:3')).toBe(false);
  });

  it('marks a receipt incomplete when the engine scope has unreviewed repos', async () => {
    const base = createLainMock();
    const lain: LainAdapter = {
      ...base,
      async getService(req) {
        const r = await base.getService(req);
        return { ...r, scope: { configured_only: true, reviewed: [], unreviewed: ['orders'] } };
      },
    };
    const d = createDispatcher({ lain, view: 'live' });
    await d.execute(call('t1', 'get_service', { service: 'orders' }));
    await d.execute(call('t2', 'list_services', {}));
    expect(d.receipts().map((r) => r.complete)).toEqual([false, true]);
  });

  it('marks a receipt incomplete when the result had to be truncated', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live', maxResultChars: 40 });
    await d.execute(call('t1', 'list_services', {}));
    expect(d.receipts()[0]?.complete).toBe(false);
  });

  it('carries the provider completeness into consumers_of receipts', async () => {
    const base = createLainMock();
    const lain: LainAdapter = {
      ...base,
      async getService(req) {
        return { ...(await base.getService(req)), provider_reviewed: false };
      },
    };
    const d = createDispatcher({ lain, view: 'live' });
    const r = await d.execute(call('t1', 'consumers_of', { service: 'orders' }));
    expect(r.ok && (r.data as { provider_complete: boolean }).provider_complete).toBe(false);
    expect(d.receipts()[0]?.complete).toBe(false);
  });

  it('resolves a service by name or by an unambiguous repo name', async () => {
    const d = createDispatcher({ lain: createLainMock(), view: 'live' });
    expect(await d.resolveService('orders')).toEqual({ service: 'orders', repo: 'orders' });
    expect(await d.resolveService('nope')).toBeNull();
  });
});

describe('summarizeConsumers', () => {
  const use = (key: string, id: string) => ({
    endpoint: { key },
    site: { id },
  });

  it('ranks endpoints by use, caps them, and declares what was omitted', () => {
    const s = summarizeConsumers(
      {
        service: 'api',
        consumers: [
          {
            service: 'web',
            repo: 'w',
            uses: [use('b', 'w:1'), use('a', 'w:2'), use('a', 'w:3'), use('c', 'w:4')],
          },
        ],
      },
      2,
    );
    const web = s.consumers[0];
    expect(web?.uses).toBe(4);
    expect(web?.distinct_endpoints).toBe(3);
    expect(web?.endpoints.map((e) => [e.key, e.uses])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect(web?.omitted_endpoints).toBe(1);
    expect(web?.endpoints[0]?.evidence_id).toBe('w:2');
  });

  it('accepts the consumer by service or repo name and always lists who the consumers are', () => {
    const svc = {
      service: 'api',
      consumers: [
        { service: 'saleor-storefront', repo: 'storefront', uses: [use('k', 's:1')] },
        { service: 'dash', repo: 'dash-repo', uses: [use('k', 'd:1')] },
      ],
    };
    const byRepo = summarizeConsumers(svc, { consumer: 'storefront' });
    expect(byRepo.consumers.map((c) => c.service)).toEqual(['saleor-storefront']);
    // Un filtro que no coincide con nadie no deja al modelo a ciegas.
    const none = summarizeConsumers(svc, { consumer: 'nope' });
    expect(none.consumers).toEqual([]);
    expect(none.available_consumers).toEqual([
      { service: 'saleor-storefront', repo: 'storefront' },
      { service: 'dash', repo: 'dash-repo' },
    ]);
  });

  it('flags a service consuming itself and tolerates uses without an endpoint', () => {
    const s = summarizeConsumers(
      {
        service: 'api',
        consumers: [
          { service: 'api', repo: 'r', uses: [{ site: { id: 'r:1' } }, use('t', 'r:2')] },
        ],
      },
      5,
    );
    expect(s.consumers[0]?.is_self).toBe(true);
    // Sólo cuenta el uso que tiene endpoint: el otro no se puede atribuir.
    expect(s.consumers[0]?.uses).toBe(1);
    expect(s.consumers[0]?.distinct_endpoints).toBe(1);
  });

  it('filters by consumer and endpoint text so a rare operation is not lost to the cap', () => {
    const svc = {
      service: 'api',
      consumers: [
        {
          service: 'web',
          repo: 'w',
          uses: [
            ...Array.from({ length: 5 }, (_, i) => use('graphql:query:products', `w:p${i}`)),
            use('graphql:mutation:attributeCreate', 'w:a1'),
          ],
        },
        { service: 'admin', repo: 'a', uses: [use('graphql:query:attributes', 'a:1')] },
      ],
    };
    // Con tope 1, sin filtro, el endpoint raro queda fuera y se declara.
    const capped = summarizeConsumers(svc, { max_endpoints: 1 });
    expect(capped.consumers[0]?.endpoints.map((e) => e.key)).toEqual(['graphql:query:products']);
    expect(capped.consumers[0]?.omitted_endpoints).toBe(1);
    // Con filtro aparece, y el otro consumidor se puede excluir.
    const filtered = summarizeConsumers(svc, {
      endpoint_contains: 'ATTRIBUTE',
      consumer: 'web',
      max_endpoints: 1,
    });
    expect(filtered.consumers).toHaveLength(1);
    expect(filtered.consumers[0]?.endpoints.map((e) => e.key)).toEqual([
      'graphql:mutation:attributeCreate',
    ]);
    expect(filtered.consumers[0]?.omitted_endpoints).toBe(0);
  });
});
