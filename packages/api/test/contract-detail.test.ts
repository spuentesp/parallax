import { describe, expect, it } from 'vitest';
import { contractKindOf, normalizeContract } from '../src/contract-detail.js';
import real from './fixtures/lain-get-contract-export-file.json' with { type: 'json' };

// `real` es la respuesta literal de `get_contract` de LAIN 0.15.0 (Saleor,
// graphql:query:exportFile): el normalizador se prueba contra lo que el motor
// devuelve de verdad, no contra una forma supuesta.
describe('normalizeContract against a real LAIN get_contract response', () => {
  const d = normalizeContract('graphql:query:exportFile', 'saleor', real);

  it('reads the provider with its file and line', () => {
    expect(d.kind).toBe('graphql query');
    expect(d.providers).toHaveLength(1);
    expect(d.providers[0]).toMatchObject({
      repo: 'saleor',
      path: 'saleor/graphql/schema.graphql',
      line: 1219,
    });
  });

  it('lists the response fields with type, nullability and required', () => {
    const response = d.schemas.find((s) => s.direction === 'response');
    expect(response?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['id', 'status', 'createdAt', 'message']),
    );
    const id = response?.fields.find((f) => f.name === 'id');
    expect(id).toMatchObject({ type: 'string', required: true, nullable: false });
    expect(response?.fields.find((f) => f.name === 'message')).toMatchObject({
      required: false,
      nullable: true,
    });
  });

  it('keeps who reads which field, with provenance and the file it was read in', () => {
    expect(d.consumers).toHaveLength(2);
    for (const c of d.consumers) {
      expect(c.repo).toBe('saleor-dashboard');
      expect(c.readsComplete).toBe(true);
      expect(c.reads.map((r) => r.field).sort()).toEqual(['id', 'status']);
      expect(c.reads[0]?.provenance).toBe('static');
      expect(c.reads[0]?.site?.path).toMatch(/\.ts$/);
    }
  });
});

describe('normalizeContract robustness', () => {
  it('a contract with no schema and no consumers yields empty lists, not a crash', () => {
    const d = normalizeContract('topic:celery/x', 'saleor', {
      items: [{ endpoint: { key: 'topic:celery/x' }, providers: [], consumers: [] }],
    });
    expect(d).toMatchObject({ kind: 'topic', schemas: [], consumers: [], providers: [] });
  });
  it('malformed or empty input does not throw', () => {
    expect(normalizeContract('http:GET /x', null, null).consumers).toEqual([]);
    expect(
      normalizeContract('http:GET /x', null, { items: [{ consumers: 'nope' }] }).consumers,
    ).toEqual([]);
  });
  it('names the kind from the key', () => {
    expect(contractKindOf('graphql:mutation:checkoutComplete')).toBe('graphql mutation');
    expect(contractKindOf('http:GET /api/x')).toBe('http');
    expect(contractKindOf('rpc:openshell.v1.OpenShell/Health')).toBe('rpc');
  });
});
