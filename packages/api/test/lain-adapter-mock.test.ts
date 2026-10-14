import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLainMock, getLainMockCalls, resetLainMock } from '../src/lain-adapter/mock.js';

describe('LainAdapter mock', () => {
  beforeEach(() => resetLainMock());
  afterEach(() => resetLainMock());

  it('exposes apiVersion=1 and a non-empty analyzerVersion', () => {
    const m = createLainMock();
    expect(m.apiVersion).toBe('1');
    expect(m.analyzerVersion).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/);
  });

  it('listServices returns the four fixture services', async () => {
    const m = createLainMock();
    const r = await m.listServices({ snapshot: 'live' });
    expect(r.items.map((s: { service: string }) => s.service)).toEqual([
      'orders',
      'billing',
      'reports',
      'platform',
    ]);
  });

  it('getService returns consumers for orders', async () => {
    const m = createLainMock();
    const r = await m.getService({ snapshot: 'live', service: 'orders' });
    expect(r.consumers[0]?.service).toBe('billing');
  });

  it('prepareSnapshot then getSnapshot transitions pending → ready', async () => {
    const m = createLainMock();
    const prep = await m.prepareSnapshot({ repos: { orders: 'b5bf29a' } });
    expect(prep.state).toBe('pending');
    expect(prep.snapshot).toMatch(/^snap_[0-9a-f]+$/);
    await new Promise((r) => setTimeout(r, 150));
    const got = await m.getSnapshot({ snapshot: prep.snapshot });
    expect(got.state).toBe('ready');
  });

  it('diffContracts on s1-remove-customer-id returns FieldRemoved', async () => {
    const m = createLainMock();
    const r = await m.diffContracts({ base: 'snap_deadbeef', head: 'snap_cafebabe' });
    expect(r.changes.some((c) => c.kind === 'FieldRemoved' && c.field === 'customer_id')).toBe(
      true,
    );
  });

  it('traceImpact returns impact paths', async () => {
    const m = createLainMock();
    const r = await m.traceImpact({
      snapshot: 'live',
      from: { field: { json_path: 'customer_id' } },
    });
    expect(r.paths[0]?.start).toContain('customer_id');
  });

  it('getCoverage surfaces unreviewed repos in scope', async () => {
    const m = createLainMock();
    const r = await m.getCoverage({ snapshot: 'live' });
    expect(r.complete).toBe(false);
    expect(r.scope?.unreviewed).toContain('reports');
  });

  it('resolveEvidence returns one item per requested ref', async () => {
    const m = createLainMock();
    const ref = 'orders@b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf:src/main.rs:12';
    const r = await m.resolveEvidence({ snapshot: 'live', refs: [ref, 'not-a-ref'] });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]?.exists).toBe(true);
    expect(r.items[0]?.ref).toBe(ref);
    expect(r.items[0]?.snippet).toContain('src/main.rs');
  });

  it('readSource returns text for the requested line range', async () => {
    const m = createLainMock();
    const r = await m.readSource({
      snapshot: 'live',
      repo: 'orders',
      path: 'src/main.rs',
      start: 10,
      end: 13,
    });
    expect(r.text).toContain('src/main.rs:11');
    expect(r.start).toBe(10);
    expect(r.end).toBe(13);
    expect(r.total_lines).toBeGreaterThan(0);
  });

  it('records calls so the smoke can assert ordering', async () => {
    const m = createLainMock();
    await m.prepareSnapshot({ repos: { orders: 'b5bf29a' } });
    const calls = getLainMockCalls();
    expect(calls.some((c) => c.tool === 'prepare_snapshot')).toBe(true);
  });

  it('returns NotImplemented for unknown service', async () => {
    const m = createLainMock();
    const err = await m.getService({ snapshot: 'live', service: 'nope' }).catch((e: unknown) => e);
    expect(err).toHaveProperty('code', 'NotImplemented');
  });
});
