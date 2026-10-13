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
    const r = await m.listServices('live');
    expect(r.items.map((s: { service: string }) => s.service)).toEqual([
      'orders',
      'billing',
      'reports',
      'platform',
    ]);
  });

  it('getService returns consumers for orders', async () => {
    const m = createLainMock();
    const r = await m.getService('live', { view: 'live', service: 'orders' });
    expect(r.consumers[0]?.consumer).toBe('billing');
  });

  it('prepareSnapshot then getSnapshot transitions pending → ready', async () => {
    const m = createLainMock();
    const prep = await m.prepareSnapshot({ repos: { orders: 'b5bf29a' } });
    expect(prep.status).toBe('pending');
    await new Promise((r) => setTimeout(r, 150));
    const got = await m.getSnapshot({ snapshotId: prep.snapshotId });
    expect(got.status).toBe('ready');
  });

  it('diffContracts on s1-remove-customer-id returns FieldRemoved', async () => {
    const m = createLainMock();
    const r = await m.diffContracts({ baseId: 'b', headId: 'h' });
    expect(r.changes.some((c) => c.kind === 'FieldRemoved' && c.field === 'customer_id')).toBe(
      true,
    );
  });

  it('traceImpact returns findings with classification', async () => {
    const m = createLainMock();
    const r = await m.traceImpact({ snapshotId: 'snap_head_s1' });
    expect(r.findings[0]?.classification).toBe('Verified');
  });

  it('getCoverage surfaces omitted repos with cause', async () => {
    const m = createLainMock();
    const r = await m.getCoverage({ snapshotId: 's' });
    expect(r.omitted.some((o) => o.repo === 'reports')).toBe(true);
  });

  it('resolveEvidence returns a resolvable record', async () => {
    const m = createLainMock();
    const r = await m.resolveEvidence({ view: 'live', evidenceId: 'e1' });
    expect(r.sha).toMatch(/[0-9a-f]{7,}/);
  });

  it('readSource returns text + cap + truncated', async () => {
    const m = createLainMock();
    const r = await m.readSource({
      view: 'live',
      repo: 'orders',
      sha: 'b5bf29a',
      path: 'src/main.rs',
    });
    expect(r.cap).toBeGreaterThan(0);
    expect(typeof r.truncated).toBe('boolean');
  });

  it('records calls so the smoke can assert ordering', async () => {
    const m = createLainMock();
    await m.prepareSnapshot({ repos: { orders: 'b5bf29a' } });
    const calls = getLainMockCalls();
    expect(calls.some((c) => c.tool === 'prepare_snapshot')).toBe(true);
  });

  it('returns NotImplemented for unknown service', async () => {
    const m = createLainMock();
    const err = await m
      .getService('live', { view: 'live', service: 'nope' })
      .catch((e: unknown) => e);
    expect(err).toHaveProperty('code', 'NotImplemented');
  });
});
