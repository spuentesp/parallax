// Contrato de cada schema de LAIN frente a un ejemplo válido escrito a mano.
// Para cada schema se prueba que: el ejemplo parsea; quitar un campo requerido
// lo rompe; un string requerido vacío lo rompe; cada miembro de un enum se
// acepta; y los args estrictos rechazan claves desconocidas. El ejemplo es la
// especificación: un schema que pierde un requisito o un miembro falla aquí.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CheckBindingArgs,
  CheckBindingReason,
  CheckBindingResponse,
  DiffContractsArgs,
  DiffContractsResponse,
  GetContractArgs,
  GetContractResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  ListContractsArgs,
  ListContractsResponse,
  ListServicesArgs,
  ListServicesResponse,
  ListUnresolvedArgs,
  ListUnresolvedResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  TemplateMatch,
  TraceImpactArgs,
  TraceImpactResponse,
} from '../src/lain/tools.js';

const DELETE = Symbol('delete');

/** Copia profunda con `value` puesto en `path` (dotted; índices numéricos para arrays). */
function setAt(root: unknown, path: string, value: unknown): unknown {
  const copy = structuredClone(root);
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = copy as Record<string, unknown> | unknown[];
  for (const k of keys) node = (node as Record<string, unknown>)[k] as typeof node;
  if (value === DELETE) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete (node as Record<string, unknown>)[last];
  } else {
    (node as Record<string, unknown>)[last] = value;
  }
  return copy;
}

interface Contract {
  name: string;
  schema: z.ZodType;
  valid: unknown;
  /** Rutas que deben existir: quitarlas rompe el parseo. */
  required?: string[];
  /** Rutas de string que no admiten vacío. */
  nonEmpty?: string[];
  /** Rutas con enum y todos sus miembros válidos. */
  enums?: Array<{ path: string; values: readonly string[] }>;
  /** Args estrictos: una clave desconocida en la raíz debe fallar. */
  strict?: boolean;
}

const snap = 'snap_ab12';
const endpoint = { key: 'http:GET /orders', service: 'orders' };

const contracts: Contract[] = [
  {
    name: 'ListServicesArgs',
    schema: ListServicesArgs,
    valid: { snapshot: snap },
    required: ['snapshot'],
    nonEmpty: ['repo', 'cursor'],
    strict: true,
  },
  {
    name: 'ListServicesResponse',
    schema: ListServicesResponse,
    valid: {
      items: [
        {
          service: 'orders',
          repo: 'orders',
          endpoints: 1,
          consumer_services: 0,
          unresolved_inbound: 0,
          paths: [],
        },
      ],
      scope: {
        configured_only: true,
        reviewed: [{ repo: 'orders', commit: 'abc', dirty: false }],
        unreviewed: [],
      },
    },
    required: [
      'items',
      'scope',
      'scope.configured_only',
      'scope.reviewed',
      'scope.unreviewed',
      'items.0.service',
      'items.0.repo',
      'items.0.endpoints',
      'items.0.consumer_services',
      'items.0.unresolved_inbound',
      'items.0.paths',
      'scope.reviewed.0.repo',
      'scope.reviewed.0.commit',
      'scope.reviewed.0.dirty',
    ],
    nonEmpty: [
      'items.0.service',
      'items.0.repo',
      'scope.reviewed.0.repo',
      'scope.reviewed.0.commit',
    ],
  },
  {
    name: 'GetServiceArgs',
    schema: GetServiceArgs,
    valid: { snapshot: snap, service: 'orders' },
    required: ['snapshot', 'service'],
    nonEmpty: ['service', 'cursor'],
    strict: true,
  },
  {
    name: 'GetServiceResponse',
    schema: GetServiceResponse,
    valid: {
      service: 'orders',
      consumers: [
        {
          service: 'billing',
          repo: 'billing',
          uses: [{ binding: { confidence: 0.9, kind: 'http' }, fields: [] }],
        },
      ],
      endpoints: ['http:GET /orders'],
    },
    required: [
      'service',
      'consumers',
      'endpoints',
      'consumers.0.service',
      'consumers.0.repo',
      'consumers.0.uses',
      'consumers.0.uses.0.binding',
      'consumers.0.uses.0.binding.confidence',
      'consumers.0.uses.0.binding.kind',
    ],
    nonEmpty: [
      'service',
      'consumers.0.service',
      'consumers.0.repo',
      'consumers.0.uses.0.binding.kind',
    ],
  },
  {
    name: 'PrepareSnapshotArgs',
    schema: PrepareSnapshotArgs,
    valid: { repos: { orders: 'abc' }, exclude: ['legacy'], configHash: 'h1' },
    nonEmpty: ['configHash'],
  },
  {
    name: 'PrepareSnapshotResponse',
    schema: PrepareSnapshotResponse,
    valid: { snapshot: snap, state: 'ready', repos: [{ repo: 'orders' }] },
    required: ['snapshot', 'state'],
    nonEmpty: ['snapshot', 'repos.0.repo'],
    enums: [{ path: 'state', values: ['pending', 'ready', 'failed'] }],
  },
  {
    name: 'GetSnapshotArgs',
    schema: GetSnapshotArgs,
    valid: { snapshot: snap },
    required: ['snapshot'],
    strict: true,
  },
  {
    name: 'GetSnapshotResponse',
    schema: GetSnapshotResponse,
    valid: { snapshot: snap, state: 'pending', error: 'boom' },
    required: ['snapshot', 'state'],
    nonEmpty: ['snapshot'],
    enums: [{ path: 'state', values: ['pending', 'ready', 'failed'] }],
  },
  {
    name: 'ListContractsArgs',
    schema: ListContractsArgs,
    valid: { snapshot: snap },
    required: ['snapshot'],
    nonEmpty: ['service', 'repo', 'cursor'],
    enums: [
      {
        path: 'kind',
        values: ['http', 'topic', 'rpc', 'graphql', 'websocket', 'table'],
      },
    ],
    strict: true,
  },
  {
    name: 'ListContractsResponse',
    schema: ListContractsResponse,
    valid: { items: [{ endpoint, has_schema: true, bound_consumers: 0 }], cursor: null },
    required: ['items', 'items.0.endpoint', 'items.0.endpoint.key', 'items.0.endpoint.service'],
    nonEmpty: ['items.0.endpoint.key', 'items.0.endpoint.service'],
  },
  {
    name: 'GetContractArgs',
    schema: GetContractArgs,
    valid: { snapshot: snap, key: 'http:GET /orders' },
    required: ['snapshot', 'key'],
    nonEmpty: ['key', 'service'],
    strict: true,
  },
  {
    name: 'GetContractResponse',
    schema: GetContractResponse,
    valid: { items: [{ endpoint }] },
    required: ['items'],
  },
  {
    name: 'ListUnresolvedArgs',
    schema: ListUnresolvedArgs,
    valid: { snapshot: snap },
    required: ['snapshot'],
    nonEmpty: ['repo', 'service', 'cursor'],
    strict: true,
  },
  {
    name: 'ListUnresolvedResponse',
    schema: ListUnresolvedResponse,
    valid: {
      items: [],
      ambiguous: [],
      scope: { configured_only: false, reviewed: [], unreviewed: [] },
    },
    required: ['items', 'ambiguous', 'scope'],
  },
  {
    name: 'CheckBindingArgs',
    schema: CheckBindingArgs,
    valid: { snapshot: snap, consumer: 'billing', endpoint },
    required: ['snapshot', 'consumer', 'endpoint', 'endpoint.key', 'endpoint.service'],
    nonEmpty: ['consumer', 'endpoint.key', 'endpoint.service'],
    strict: true,
  },
  {
    name: 'CheckBindingResponse',
    schema: CheckBindingResponse,
    valid: {
      valid: true,
      reasons: ['already_bound'],
      method_match: true,
      template_match: 'exact',
      bindings_entry: 'x',
    },
    required: ['valid', 'reasons', 'method_match', 'template_match'],
  },
  {
    name: 'DiffContractsArgs',
    schema: DiffContractsArgs,
    valid: { base: snap, head: 'snap_cd34' },
    required: ['base', 'head'],
    nonEmpty: ['service', 'repo'],
    enums: [{ path: 'min_impact', values: ['Verified', 'NeedsInvestigation', 'NoKnownImpact'] }],
    strict: true,
  },
  {
    name: 'DiffContractsResponse',
    schema: DiffContractsResponse,
    valid: {
      changes: [
        { kind: 'FieldRemoved', service: 'orders', endpoint: { key: 'k', service: 'orders' } },
      ],
    },
    required: ['changes', 'changes.0.kind'],
    nonEmpty: [
      'changes.0.kind',
      'changes.0.service',
      'changes.0.endpoint.key',
      'changes.0.endpoint.service',
    ],
  },
  {
    name: 'TraceImpactArgs',
    schema: TraceImpactArgs,
    valid: { snapshot: snap, from: { endpoint } },
    required: ['snapshot', 'from'],
    nonEmpty: ['from.endpoint.key', 'from.endpoint.service'],
    strict: true,
  },
  {
    name: 'TraceImpactResponse',
    schema: TraceImpactResponse,
    valid: {
      paths: [
        {
          start: 'orders',
          min_confidence: 0.5,
          hops: [{ edge: 'uses', node: 'billing', node_type: 'service' }],
        },
      ],
    },
    required: [
      'paths',
      'paths.0.start',
      'paths.0.min_confidence',
      'paths.0.hops',
      'paths.0.hops.0.edge',
      'paths.0.hops.0.node',
      'paths.0.hops.0.node_type',
    ],
    nonEmpty: [
      'paths.0.start',
      'paths.0.hops.0.edge',
      'paths.0.hops.0.node',
      'paths.0.hops.0.node_type',
    ],
  },
  {
    name: 'GetCoverageArgs',
    schema: GetCoverageArgs,
    valid: { snapshot: snap, endpoint },
    required: ['snapshot'],
    nonEmpty: ['endpoint.key', 'endpoint.service'],
    strict: true,
  },
  {
    name: 'GetCoverageResponse',
    schema: GetCoverageResponse,
    valid: { complete: true },
    required: ['complete'],
  },
  {
    name: 'ResolveEvidenceArgs',
    schema: ResolveEvidenceArgs,
    valid: { snapshot: snap, refs: ['orders@abc:src/a.ts:1'] },
    required: ['snapshot', 'refs'],
    nonEmpty: ['refs.0'],
    strict: true,
  },
  {
    name: 'ResolveEvidenceResponse',
    schema: ResolveEvidenceResponse,
    valid: {
      items: [
        {
          exists: true,
          ref: 'orders@abc:src/a.ts:1',
          node: { id: 'n1', node_type: 'function', ref: { repo: 'orders' } },
        },
      ],
    },
    required: [
      'items',
      'items.0.exists',
      'items.0.ref',
      'items.0.node.id',
      'items.0.node.node_type',
    ],
    nonEmpty: ['items.0.node.id', 'items.0.node.node_type'],
  },
  {
    name: 'ReadSourceArgs',
    schema: ReadSourceArgs,
    valid: { snapshot: snap, repo: 'orders', path: 'src/a.ts', start: 0, end: 0 },
    required: ['snapshot', 'repo', 'path', 'start', 'end'],
    nonEmpty: ['repo', 'path'],
    strict: true,
  },
  {
    name: 'ReadSourceResponse',
    schema: ReadSourceResponse,
    valid: { text: '', path: 'src/a.ts', start: 0, end: 0, commit: 'abc', total_lines: 0 },
    required: ['text', 'path', 'start', 'end', 'commit', 'total_lines'],
    nonEmpty: ['path', 'commit'],
  },
];

describe.each(contracts)('$name contract', (c) => {
  it('accepts the documented example', () => {
    expect(c.schema.safeParse(c.valid).success).toBe(true);
  });

  for (const path of c.required ?? []) {
    it(`requires ${path}`, () => {
      expect(c.schema.safeParse(setAt(c.valid, path, DELETE)).success).toBe(false);
    });
  }

  for (const path of c.nonEmpty ?? []) {
    it(`rejects an empty string at ${path}`, () => {
      expect(c.schema.safeParse(setAt(c.valid, path, '')).success).toBe(false);
    });
  }

  for (const { path, values } of c.enums ?? []) {
    it(`accepts every member of ${path}`, () => {
      for (const value of values) {
        expect(c.schema.safeParse(setAt(c.valid, path, value)).success).toBe(true);
      }
    });

    it(`rejects a value outside ${path}`, () => {
      expect(c.schema.safeParse(setAt(c.valid, path, 'not-a-member')).success).toBe(false);
    });
  }

  if (c.strict) {
    it('rejects unknown top-level keys', () => {
      expect(c.schema.safeParse({ ...(c.valid as object), bogus: 1 }).success).toBe(false);
    });
  }
});

describe('trace_impact field direction', () => {
  it.each(['request', 'response', 'payload'])('accepts direction %s', (direction) => {
    const args = { snapshot: snap, from: { field: { direction, endpoint } } };
    expect(TraceImpactArgs.safeParse(args).success).toBe(true);
  });

  it('rejects a direction outside the three members', () => {
    const args = { snapshot: snap, from: { field: { direction: 'both', endpoint } } };
    expect(TraceImpactArgs.safeParse(args).success).toBe(false);
  });
});

describe('enum schemas used on their own', () => {
  it.each([
    'not_a_consumer',
    'method_mismatch',
    'template_mismatch',
    'same_service',
    'already_bound',
    'op_mismatch',
    'field_mismatch',
  ])('CheckBindingReason accepts %s', (reason) => {
    expect(CheckBindingReason.safeParse(reason).success).toBe(true);
  });

  it.each(['exact', 'pattern', 'prefix_stripped', 'none'])('TemplateMatch accepts %s', (m) => {
    expect(TemplateMatch.safeParse(m).success).toBe(true);
  });

  it('rejects an unknown binding reason', () => {
    expect(CheckBindingReason.safeParse('made_up').success).toBe(false);
  });
});

describe('confidence bounds on binding', () => {
  const withConfidence = (confidence: number) => ({
    service: 'orders',
    repo: 'orders',
    uses: [{ binding: { confidence, kind: 'http' } }],
  });
  const response = (confidence: number) => ({
    service: 'orders',
    consumers: [withConfidence(confidence)],
    endpoints: [],
  });

  it.each([0, 0.5, 1])('accepts confidence %s', (c) => {
    expect(GetServiceResponse.safeParse(response(c)).success).toBe(true);
  });

  it.each([-0.01, 1.01])('rejects confidence %s', (c) => {
    expect(GetServiceResponse.safeParse(response(c)).success).toBe(false);
  });
});

describe('trace_impact from-object', () => {
  const args = (from: unknown) => ({ snapshot: snap, from });

  it.each([{ endpoint }, { field: { direction: 'request', endpoint } }, { symbol: 'createOrder' }])(
    'accepts exactly-one-start %j',
    (from) => {
      expect(TraceImpactArgs.safeParse(args(from)).success).toBe(true);
    },
  );

  it('rejects a from with no endpoint, field or symbol', () => {
    expect(TraceImpactArgs.safeParse(args({})).success).toBe(false);
  });

  it('rejects a from whose endpoint is not an object', () => {
    expect(TraceImpactArgs.safeParse(args({ endpoint: 'orders' })).success).toBe(false);
  });

  it('rejects a non-string symbol', () => {
    expect(TraceImpactArgs.safeParse(args({ symbol: 7 })).success).toBe(false);
  });

  it.each([1, 500])('accepts cap %i', (cap) => {
    expect(TraceImpactArgs.safeParse({ ...args({ endpoint }), cap }).success).toBe(true);
  });

  it.each([0, 501])('rejects cap %i', (cap) => {
    expect(TraceImpactArgs.safeParse({ ...args({ endpoint }), cap }).success).toBe(false);
  });
});

describe('response nested fields', () => {
  it('defaults a use without fields to an empty list', () => {
    const parsed = GetServiceResponse.parse({
      service: 'orders',
      consumers: [
        {
          service: 'billing',
          repo: 'billing',
          uses: [{ binding: { confidence: 1, kind: 'http' } }],
        },
      ],
      endpoints: [],
    });
    expect(parsed.consumers[0]?.uses[0]?.fields).toEqual([]);
  });

  it('rejects a caller anchor whose line is not an integer', () => {
    const use = {
      binding: { confidence: 1, kind: 'http' },
      caller: { repo: 'billing', path: 'a.ts', line: 'twelve' },
    };
    const response = {
      service: 'orders',
      consumers: [{ service: 'billing', repo: 'billing', uses: [use] }],
      endpoints: [],
    };
    expect(GetServiceResponse.safeParse(response).success).toBe(false);
  });

  it('rejects a provenance whose kind is empty', () => {
    const response = {
      paths: [
        {
          start: 'orders',
          min_confidence: 0.5,
          hops: [
            {
              edge: 'uses',
              node: 'billing',
              node_type: 'service',
              provenance: { confidence: 0.5, kind: '' },
            },
          ],
        },
      ],
    };
    expect(TraceImpactResponse.safeParse(response).success).toBe(false);
  });

  it('rejects an empty route on a change', () => {
    const change = { kind: 'FieldRemoved', route: '' };
    expect(DiffContractsResponse.safeParse({ changes: [change] }).success).toBe(false);
  });

  it('rejects a scope whose reviewed list is not an array', () => {
    const response = {
      items: [],
      ambiguous: [],
      scope: { configured_only: true, reviewed: 'orders' },
    };
    expect(ListUnresolvedResponse.safeParse(response).success).toBe(false);
  });

  it('rejects a non-boolean configured_only in an unresolved scope', () => {
    const response = {
      items: [],
      ambiguous: [],
      scope: { configured_only: 'yes' },
    };
    expect(ListUnresolvedResponse.safeParse(response).success).toBe(false);
  });
});
