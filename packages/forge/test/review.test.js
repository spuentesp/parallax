// Tests for pairing a ticket's prediction with its pull request's real analysis.
// The assessment fixture is a trimmed copy of a real report (OpenShell PR #5052).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assessmentMatchesPr,
  computeDrift,
  contactsFor,
  extractPrRefs,
  nextSteps,
  summarizeAssessment,
} from '../src/review.js';

const real = JSON.parse(
  readFileSync(new URL('./fixtures/assessment-5052.json', import.meta.url), 'utf8'),
);
// A real code-only PR (NemoClaw #13812): no contract findings, but risky code edits.
const codeOnly = JSON.parse(
  readFileSync(new URL('./fixtures/assessment-13812.json', import.meta.url), 'utf8'),
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

  it('shows the riskiest edited code first, untested before tested', () => {
    const risks = s.codeImpact.symbols.map((x) => x.risk);
    const order = { high: 0, medium: 1, low: 2 };
    expect(risks).toEqual([...risks].sort((a, b) => order[a] - order[b]));
    const high = s.codeImpact.symbols.filter((x) => x.risk === 'high');
    const firstTested = high.findIndex((x) => !x.untested);
    const lastUntested = high.map((x) => !x.untested).lastIndexOf(false);
    if (firstTested !== -1) expect(lastUntested).toBeLessThan(firstTested);
  });

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

// Consumers as the resolver returns them, with the owner a human wrote on their page.
const owned = (service, owner, criticality, provenance = 'deterministic') => ({
  service,
  provenance,
  annotations: owner ? { owner, criticality } : undefined,
});
const withConsumers = (...consumers) => ({ targets: [{ node: { kind: 'service' }, consumers }] });

describe('contactsFor', () => {
  it('lists owners once per service, most critical first', () => {
    const c = contactsFor(
      withConsumers(
        owned('web', 'Web team', 'Low'),
        owned('nemoclaw', 'Platform team', 'High'),
        owned('web', 'Someone else', 'High'),
        owned('sdk', undefined),
      ),
    );
    expect(c).toEqual([
      { service: 'nemoclaw', owner: 'Platform team', criticality: 'High' },
      { service: 'web', owner: 'Web team', criticality: 'Low' },
    ]);
  });
  it('returns nothing when nobody wrote an owner down', () => {
    expect(contactsFor(withConsumers(owned('sdk', undefined)))).toEqual([]);
    expect(contactsFor(undefined)).toEqual([]);
  });
});

describe('nextSteps', () => {
  it('tells the reader to name something when the ticket names nothing', () => {
    expect(nextSteps({ expected: { targets: [] } })).toEqual([
      'Name the service or endpoint this ticket changes, so Parallax can predict its impact.',
    ]);
  });

  it('starts with who to talk to and never runs past five steps', () => {
    const expected = withConsumers(
      owned('a', 'Team A', 'High'),
      owned('b', 'Team B', 'High'),
      owned('c', 'Team C', 'High'),
      owned('d', undefined, undefined, 'inferred'),
    );
    const steps = nextSteps({ expected });
    expect(steps[0]).toBe('Talk to Team A (owns a, high criticality) before this ships.');
    expect(steps).toHaveLength(3); // two contacts + the inferred warning
    expect(steps.at(-1)).toMatch(/inferred dependency on d/);
  });

  it('asks the reader to confirm contracts the ticket never named (real report)', () => {
    const s = summarizeAssessment(real);
    const expected = {
      targets: [
        endpointTarget('rpc:openshell.v1.OpenShell/ConnectSupervisor', 'openshell-gateway'),
      ],
    };
    const steps = nextSteps({ expected, drift: computeDrift(expected, s), summary: s });
    expect(steps.some((t) => /3 contracts the ticket did not name are intended/.test(t))).toBe(
      true,
    );
    // coverage is incomplete in this report, and the last step must say so
    expect(steps.at(-1)).toMatch(/cannot prove the absence of impact/);
  });

  it('points at the riskiest edit and at missing tests for a code-only PR (real report)', () => {
    const s = summarizeAssessment(codeOnly);
    const expected = { targets: [serviceTarget('nemoclaw')] };
    const steps = nextSteps({ expected, drift: computeDrift(expected, s), summary: s });
    expect(steps[0]).toMatch(
      /second reviewer read requireNativeProviderPolicy .*provider-policy\.ts:98.*high risk/,
    );
    expect(
      steps.some((t) => /Add tests for the 1 untested edited symbol in NemoClaw/.test(t)),
    ).toBe(true);
  });

  it('flags proven consumers differently from open questions', () => {
    const summary = {
      coverage: { complete: true },
      findings: [
        { endpoint: 'x', service: 's', class: 'Verified', affectedDistinct: 2, affectedByRepo: {} },
      ],
    };
    const drift = computeDrift({ targets: [serviceTarget('other')] }, summary);
    expect(
      nextSteps({ expected: { targets: [serviceTarget('other')] }, drift, summary })[0],
    ).toMatch(/^1 contract the ticket never named has proven consumers/);
  });

  it('uses the plural form for several proven contracts', () => {
    const finding = (endpoint) => ({
      endpoint,
      service: 's',
      class: 'Verified',
      affectedDistinct: 1,
      affectedByRepo: {},
    });
    const summary = { coverage: { complete: true }, findings: [finding('a'), finding('b')] };
    const expected = { targets: [serviceTarget('other')] };
    expect(nextSteps({ expected, drift: computeDrift(expected, summary), summary })[0]).toMatch(
      /^2 contracts the ticket never named have proven consumers/,
    );
  });
});

describe('drift ranking', () => {
  it('puts proven findings first, then those with the most distinct consumers', () => {
    const f = (endpoint, cls, n) => ({
      endpoint,
      service: 'x',
      class: cls,
      affectedDistinct: n,
      affectedByRepo: {},
    });
    const d = computeDrift(
      { targets: [serviceTarget('elsewhere')] },
      {
        coverage: { complete: true },
        findings: [
          f('small', 'NeedsInvestigation', 1),
          f('big', 'NeedsInvestigation', 9),
          f('proven', 'Verified', 1),
        ],
      },
    );
    expect(d.touchedButNotNamed.map((x) => x.endpoint)).toEqual(['proven', 'big', 'small']);
  });
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

  it('reports risky code edits even when no contract changed (real code-only PR)', () => {
    const s = summarizeAssessment(codeOnly);
    expect(s.status).toBe('READY');
    expect(s.counts).toEqual({ verified: 0, needsInvestigation: 0, noKnownImpact: 0 });
    expect(s.codeImpact).toMatchObject({ repo: 'NemoClaw', symbolsTotal: 2, untestedTotal: 1 });

    const d = computeDrift({ targets: [serviceTarget('nemoclaw')] }, s);
    expect(d.verdict).toBe('code-only');
    expect(d.codeChanges).toMatchObject({ repo: 'NemoClaw', symbols: 2, highestRisk: 'high' });
    expect(d.headline).toBe(
      'The PR changed no contracts, but edited 2 code symbols in NemoClaw (highest risk: high; 1 untested).',
    );
    // coverage is incomplete in this report, so the caveat must still be there
    expect(d.caveat).toMatch(/does not mean "safe"/);
  });

  it('still says code-only when the ticket named nothing', () => {
    const d = computeDrift({ targets: [] }, summarizeAssessment(codeOnly));
    expect(d.verdict).toBe('code-only');
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
