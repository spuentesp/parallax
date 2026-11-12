// Verificación de afirmaciones tipadas (docs/superpowers/specs/
// 2026-10-26-verifiable-claims-design.md): el motor adjudica las relaciones; una
// contradicción se señala en el veredicto, no se oculta ni se corrige.

import { describe, expect, it } from 'vitest';
import {
  type Claim,
  type ClaimEvidence,
  SUBMIT_TOOL_SPEC,
  SubmitAnswerArgs,
  summarizeClaims,
  verifyClaims,
} from '../src/agent/claims.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const SERVICES = [
  { service: 'orders', repo: 'orders' },
  { service: 'billing', repo: 'billing' },
  { service: 'reports', repo: 'reports-repo' },
];

// El mock: orders es consumido por billing y reports; billing no consume orders al revés.
function lainWith(scope?: { unreviewed: string[] }, providerReviewed?: boolean): LainAdapter {
  const base = createLainMock();
  return {
    ...base,
    async getService(req) {
      const r = await base.getService(req);
      return {
        ...r,
        ...(scope ? { scope: { configured_only: true, reviewed: [], ...scope } } : {}),
        ...(providerReviewed === undefined ? {} : { provider_reviewed: providerReviewed }),
      };
    },
  };
}

const none: ClaimEvidence = { accepted: [], receipts: [], rejected: [] };

function deps(lain: LainAdapter, validate?: (refs: string[]) => ClaimEvidence) {
  return {
    lain,
    view: 'live',
    resolveService: async (name: string) =>
      SERVICES.find((s) => s.service === name) ?? SERVICES.find((s) => s.repo === name) ?? null,
    validateRefs: async (refs: string[]) => (validate ? validate(refs) : none),
  };
}

const rel = (
  consumer: string,
  provider: string,
  polarity: 'present' | 'absent',
  evidence?: string[],
): Claim => ({
  kind: 'relation',
  consumer,
  provider,
  polarity,
  ...(evidence ? { evidence } : {}),
});

describe('verifyClaims — relation claims are adjudicated by the engine', () => {
  it('verifies a present relation the engine records', async () => {
    const [r] = await verifyClaims([rel('billing', 'orders', 'present')], deps(lainWith()));
    expect(r?.verdict).toBe('verified');
    expect(r?.engine?.uses).toBeGreaterThan(0);
    expect(r?.engine?.endpoints.length).toBeGreaterThan(0);
  });

  it('flags a present relation the engine does not record as contradicted, with the engine side', async () => {
    const [r] = await verifyClaims([rel('orders', 'billing', 'present')], deps(lainWith()));
    expect(r?.verdict).toBe('contradicted');
    expect(r?.engine).toMatchObject({ uses: 0, complete: true });
  });

  it('verifies a correct absence over a complete scope without any code anchor', async () => {
    const [r] = await verifyClaims([rel('reports', 'billing', 'absent')], deps(lainWith()));
    expect(r?.verdict).toBe('verified');
    expect(r?.evidence.accepted).toEqual([]);
  });

  it('contradicts an absence the engine disagrees with, and says what it has', async () => {
    const [r] = await verifyClaims([rel('billing', 'orders', 'absent')], deps(lainWith()));
    expect(r?.verdict).toBe('contradicted');
    expect(r?.reason).toContain('billing');
    expect(r?.engine?.endpoints.length).toBeGreaterThan(0);
  });

  it('does not accept an absence when the consumer repo was not reviewed', async () => {
    const lain = lainWith({ unreviewed: ['reports-repo'] });
    const [r] = await verifyClaims([rel('reports', 'billing', 'absent')], deps(lain));
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.engine?.complete).toBe(false);
    expect(r?.reason).toContain('reports-repo');
  });

  it('does not accept an absence when the provider itself was not reviewed', async () => {
    const [r] = await verifyClaims(
      [rel('reports', 'billing', 'absent')],
      deps(lainWith(undefined, false)),
    );
    expect(r?.verdict).toBe('unverifiable');
  });

  it('a recorded edge still contradicts an absence even over an incomplete scope', async () => {
    const lain = lainWith({ unreviewed: ['reports-repo'] });
    const [r] = await verifyClaims([rel('billing', 'orders', 'absent')], deps(lain));
    expect(r?.verdict).toBe('contradicted');
  });

  it('resolves a service by its repo name when that is unambiguous', async () => {
    const [r] = await verifyClaims([rel('reports-repo', 'orders', 'present')], deps(lainWith()));
    expect(r?.verdict).toBe('verified');
  });

  it('is unverifiable, not contradicted, for a service outside the view', async () => {
    const [r] = await verifyClaims([rel('ghost', 'orders', 'present')], deps(lainWith()));
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toContain('ghost');
  });

  it('reports an engine failure as unverifiable with the cause', async () => {
    const lain: LainAdapter = {
      ...createLainMock(),
      async getService() {
        throw new Error('connection refused');
      },
    };
    const [r] = await verifyClaims([rel('billing', 'orders', 'present')], deps(lain));
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toContain('connection refused');
  });

  it('records the evidence a relation claim cited, without needing it for the verdict', async () => {
    const [r] = await verifyClaims(
      [rel('billing', 'orders', 'present', ['x:1', 'bogus'])],
      deps(lainWith(), () => ({
        accepted: ['x:1'],
        receipts: [],
        rejected: [{ ref: 'bogus', reason: 'not_delivered_by_backend' }],
      })),
    );
    expect(r?.verdict).toBe('verified');
    expect(r?.evidence.accepted).toEqual(['x:1']);
    expect(r?.evidence.rejected).toHaveLength(1);
  });
});

describe('verifyClaims — note claims', () => {
  const note = (evidence: string[]): Claim => ({ kind: 'note', text: 'something', evidence });

  it('is supported when a cited anchor or receipt resolved', async () => {
    const withAnchor = await verifyClaims(
      [note(['a'])],
      deps(lainWith(), () => ({ accepted: ['a'], receipts: [], rejected: [] })),
    );
    expect(withAnchor[0]?.verdict).toBe('supported');
    const withReceipt = await verifyClaims(
      [note(['q:1'])],
      deps(lainWith(), () => ({ accepted: [], receipts: ['q:1'], rejected: [] })),
    );
    expect(withReceipt[0]?.verdict).toBe('supported');
  });

  it('is unsupported when nothing it cited was delivered', async () => {
    const [r] = await verifyClaims(
      [note(['fake'])],
      deps(lainWith(), () => ({
        accepted: [],
        receipts: [],
        rejected: [{ ref: 'fake', reason: 'not_delivered_by_backend' }],
      })),
    );
    expect(r?.verdict).toBe('unsupported');
  });
});

describe('summarizeClaims and the submit schema', () => {
  it('counts each verdict', async () => {
    const results = await verifyClaims(
      [rel('billing', 'orders', 'present'), rel('orders', 'billing', 'present')],
      deps(lainWith()),
    );
    expect(summarizeClaims(results)).toEqual({
      total: 2,
      verified: 1,
      contradicted: 1,
      unverifiable: 0,
      supported: 0,
      unsupported: 0,
    });
  });

  it('accepts a well-formed submission and rejects malformed ones', () => {
    expect(
      SubmitAnswerArgs.safeParse({ answer: 'a', claims: [rel('a', 'b', 'absent')] }).success,
    ).toBe(true);
    expect(SubmitAnswerArgs.safeParse({ answer: 'a' }).success).toBe(true);
    expect(SubmitAnswerArgs.safeParse({ claims: [] }).success).toBe(false);
    expect(
      SubmitAnswerArgs.safeParse({
        answer: 'a',
        claims: [{ kind: 'note', text: 't', evidence: [] }],
      }).success,
    ).toBe(false);
    expect(
      SubmitAnswerArgs.safeParse({ answer: 'a', claims: [{ kind: 'relation', consumer: 'x' }] })
        .success,
    ).toBe(false);
    expect(SubmitAnswerArgs.safeParse({ answer: 'a', extra: 1 }).success).toBe(false);
  });

  it('exposes the tool spec the model sees', () => {
    expect(SUBMIT_TOOL_SPEC.function.name).toBe('submit_answer');
    expect(JSON.stringify(SUBMIT_TOOL_SPEC.function.parameters)).toContain('polarity');
  });
});
