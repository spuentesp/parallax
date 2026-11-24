// Tests for pairing a ticket's prediction with its pull request's real analysis.
// The assessment fixture is a trimmed copy of a real report (OpenShell PR #5052).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assessmentMatchesPr,
  computeDrift,
  extractPrRefs,
  summarizeAssessment,
} from '../src/review.js';

const real = JSON.parse(
  readFileSync(new URL('./fixtures/assessment-5052.json', import.meta.url), 'utf8'),
);

describe('extractPrRefs', () => {
  it('finds GitHub pull request URLs and ignores everything else', () => {
    const refs = extractPrRefs(
      'See https://github.com/NVIDIA/OpenShell/pull/5052 and https://github.com/NVIDIA/OpenShell/issues/9 and https://example.com/x/pull/3',
    );
    expect(refs).toEqual([
      {
        owner: 'NVIDIA',
        repo: 'OpenShell',
        number: 5052,
        url: 'https://github.com/NVIDIA/OpenShell/pull/5052',
      },
    ]);
  });
  it('does not repeat the same PR written in a different case', () => {
    const refs = extractPrRefs(
      'https://github.com/NVIDIA/OpenShell/pull/5052 https://github.com/nvidia/openshell/pull/5052',
    );
    expect(refs).toHaveLength(1);
  });
  it('returns nothing for empty input', () => {
    expect(extractPrRefs('')).toEqual([]);
    expect(extractPrRefs(undefined)).toEqual([]);
  });
});

describe('assessmentMatchesPr', () => {
  const ref = { owner: 'nvidia', repo: 'openshell', number: 5052 };
  it('matches the PR the assessment analysed, ignoring case', () => {
    expect(assessmentMatchesPr(real, ref)).toBe(true);
  });
  it('rejects another number or an assessment with no PR', () => {
    expect(assessmentMatchesPr(real, { ...ref, number: 1 })).toBe(false);
    expect(assessmentMatchesPr({ manifest: {} }, ref)).toBe(false);
    expect(assessmentMatchesPr(undefined, ref)).toBe(false);
  });
});

describe('summarizeAssessment (real report)', () => {
  const s = summarizeAssessment(real);

  it('keeps the identity and status, and counts the classes honestly', () => {
    expect(s.id).toBe(real.id);
    expect(s.status).toBe('PARTIAL');
    expect(s.pr).toBe('NVIDIA/OpenShell#5052');
    expect(s.counts).toEqual({ verified: 0, needsInvestigation: 4, noKnownImpact: 0 });
  });

  it('collapses repeated call sites so a reader sees consumers, not a wall of lines', () => {
    const attach = s.findings.find((f) => f.endpoint.endsWith('SupervisorHost/Attach'));
    expect(attach.affectedTotal).toBeGreaterThan(attach.affectedDistinct);
    expect(attach.affectedByRepo).toMatchObject({ 'NeMo-Fabric': expect.any(Number) });
  });

  it('says plainly that incomplete coverage is not proof of safety', () => {
    expect(s.coverage.complete).toBe(false);
    expect(s.coverage.note).toMatch(/does not prove there is no impact/);
  });

  it('labels the model-written explanation as such and caps its length', () => {
    expect(s.explanation.model).toMatch(/Nemotron/i);
    expect(s.explanation.note).toMatch(/language model/);
    expect(s.explanation.text.length).toBeLessThanOrEqual(701);
  });

  it('sorts Verified before NeedsInvestigation before NoKnownImpact', () => {
    const mixed = summarizeAssessment({
      id: 'x',
      status: 'READY',
      coverage: { complete: true },
      findings: [
        { endpoint: { key: 'a' }, impact: { class: 'NoKnownImpact' }, affected: [] },
        { endpoint: { key: 'b' }, impact: { class: 'Verified' }, affected: [] },
        { endpoint: { key: 'c' }, impact: { class: 'NeedsInvestigation' }, affected: [] },
      ],
    });
    expect(mixed.findings.map((f) => f.class)).toEqual([
      'Verified',
      'NeedsInvestigation',
      'NoKnownImpact',
    ]);
    expect(mixed.coverage.note).toBe('Coverage is complete.');
  });

  it('survives a report with nothing in it', () => {
    const empty = summarizeAssessment({ id: 'e', status: 'READY' });
    expect(empty).toMatchObject({
      counts: { verified: 0, needsInvestigation: 0, noKnownImpact: 0 },
      findings: [],
      codeImpact: null,
      explanation: null,
    });
  });
});

// A prediction shaped like resolve.js output.
const endpointTarget = (label, service) => ({ node: { kind: 'endpoint', label, service } });
const serviceTarget = (label) => ({ node: { kind: 'service', label } });
const summary = (endpoints, complete = false) => ({
  coverage: { complete },
  findings: endpoints.map(([endpoint, service]) => ({
    endpoint,
    service,
    class: 'NeedsInvestigation',
  })),
});

describe('computeDrift', () => {
  it('reports aligned when the PR touched exactly what the ticket named', () => {
    const d = computeDrift(
      { targets: [endpointTarget('rpc:x/A', 'gw')] },
      summary([['rpc:x/A', 'gw']], true),
    );
    expect(d.verdict).toBe('aligned');
    expect(d.confirmed).toEqual(['rpc:x/A']);
    expect(d.caveat).toBeNull();
  });

  it('reports a wider PR: some named contracts touched, others never mentioned', () => {
    const d = computeDrift(
      { targets: [endpointTarget('rpc:x/A', 'gw')] },
      summary([
        ['rpc:x/A', 'gw'],
        ['rpc:x/B', 'gw'],
        ['rpc:y/C', 'other'],
      ]),
    );
    expect(d.verdict).toBe('wider-than-ticket');
    expect(d.touchedButNotNamed).toEqual([
      expect.objectContaining({ endpoint: 'rpc:x/B', serviceWasNamed: true }),
      expect.objectContaining({ endpoint: 'rpc:y/C', serviceWasNamed: false }),
    ]);
    expect(d.headline).toMatch(/touched 1 contract the ticket named, and 2 it never mentioned/);
  });

  it('treats naming a whole service as naming all of its endpoints for the service check', () => {
    const d = computeDrift({ targets: [serviceTarget('gw')] }, summary([['rpc:x/B', 'gw']]));
    expect(d.touchedButNotNamed[0].serviceWasNamed).toBe(true);
  });

  it('reports a different PR when nothing the ticket named was touched', () => {
    const d = computeDrift(
      { targets: [endpointTarget('rpc:x/A', 'gw')] },
      summary([['rpc:y/C', 'other']]),
    );
    expect(d.verdict).toBe('different');
    expect(d.namedButUntouched).toEqual(['rpc:x/A']);
  });

  it('flags a ticket that named nothing while the PR touched contracts', () => {
    const d = computeDrift({ targets: [] }, summary([['rpc:x/A', 'gw']]));
    expect(d.verdict).toBe('ticket-named-nothing');
  });

  it('handles a PR that changed no contracts', () => {
    const d = computeDrift({ targets: [endpointTarget('rpc:x/A', 'gw')] }, summary([]));
    expect(d.verdict).toBe('pr-touched-no-contracts');
    expect(d.headline).toMatch(/although the ticket named 1/);
  });

  it('warns that "untouched" is not "safe" when coverage is incomplete', () => {
    const d = computeDrift({ targets: [endpointTarget('rpc:x/A', 'gw')] }, summary([], false));
    expect(d.caveat).toMatch(/does not mean "safe"/);
  });

  it('works end to end on the real report: wider than a ticket that named one contract', () => {
    const d = computeDrift(
      {
        targets: [
          endpointTarget('rpc:openshell.v1.OpenShell/ConnectSupervisor', 'openshell-gateway'),
        ],
      },
      summarizeAssessment(real),
    );
    expect(d.verdict).toBe('wider-than-ticket');
    expect(d.confirmed).toEqual(['rpc:openshell.v1.OpenShell/ConnectSupervisor']);
    expect(d.touchedButNotNamed.length).toBe(3);
  });
});
