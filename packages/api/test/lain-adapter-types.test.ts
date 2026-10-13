import { describe, expect, it } from 'vitest';
import type { LainAdapter, LainCallErrorCode } from '../src/lain-adapter/index.js';
import { isLainCallError, LainCallError } from '../src/lain-adapter/index.js';

describe('LainCallError', () => {
  it('lists every documented code', () => {
    const cases: Array<[LainCallErrorCode, Record<string, unknown>]> = [
      ['LainUnavailable', {}],
      ['SnapshotNotReady', { snapshotId: 's1' }],
      ['ApiVersionMismatch', { expected: '1', actual: '2' }],
      ['AnalyzerVersionMismatch', { expected: '0.9', actual: '1.0' }],
      ['ToolSchemaMismatch', { tool: 'get_service', detail: 'missing field' }],
      ['IncompatibleView', { view: 'live' }],
      ['NotImplemented', { doc: 'https://example.com/doc' }],
    ];
    for (const [code, extra] of cases) {
      expect(LainCallError.parse({ code, message: 'x', ...extra }).code).toBe(code);
    }
  });
  it('isLainCallError narrows correctly', () => {
    const e = LainCallError.parse({
      code: 'SnapshotNotReady',
      message: 'pending',
      snapshotId: 's1',
    });
    expect(isLainCallError(e)).toBe(true);
    expect(isLainCallError(new Error('nope'))).toBe(false);
  });
  it('NotImplemented carries a doc field', () => {
    const e = LainCallError.parse({
      code: 'NotImplemented',
      message: 'not in MVP',
      doc: 'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md',
    });
    if (e.code === 'NotImplemented') expect(e.doc).toMatch(/^https:\/\//);
  });
});

describe('LainAdapter interface compiles', () => {
  it('can be implemented by an empty mock', () => {
    const stub: Partial<LainAdapter> = {
      analyzerVersion: '0.0.0',
      apiVersion: '1',
    };
    expect(stub.apiVersion).toBe('1');
  });
});
