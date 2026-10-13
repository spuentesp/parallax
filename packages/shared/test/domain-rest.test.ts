import { describe, expect, it } from 'vitest';
import { ArchitectureProposal, type ProposalOption } from '../src/domain/architecture-proposal.js';
import { Coverage } from '../src/domain/coverage.js';
import { EvidenceRef } from '../src/domain/evidence-ref.js';
import { Finding } from '../src/domain/finding.js';
import { asAssessmentId, asEvidenceId, asProposalId } from '../src/domain/ids.js';
import { Publication, PublicationState } from '../src/domain/publication.js';

describe('Finding', () => {
  it('captures the motor classification (never promoted by the model)', () => {
    const f = Finding.parse({
      id: 'f1',
      assessmentId: asAssessmentId('a_1'),
      changeDetected: { kind: 'FieldRemoved', service: 'orders', field: 'customer_id' },
      classification: 'Verified',
      consumers: ['billing'],
      evidenceRefs: [asEvidenceId('e1')],
    });
    expect(f.classification).toBe('Verified');
  });
});

describe('EvidenceRef', () => {
  it('has view + sha + path; resolvable before cited', () => {
    const e = EvidenceRef.parse({
      id: asEvidenceId('e1'),
      assessmentId: asAssessmentId('a_1'),
      view: 'snapshot:abc',
      repo: 'orders',
      sha: 'b5bf29a',
      path: 'src/main.rs',
      range: { start: 10, end: 20 },
      hash: 'h_1',
    });
    expect(e.view).toBe('snapshot:abc');
    expect(e.range?.start).toBe(10);
  });
});

describe('Coverage', () => {
  it('omits are first-class, not hidden', () => {
    const c = Coverage.parse({
      reviewed: ['orders'],
      omitted: [{ repo: 'reports', cause: 'excluded' }],
      refsUnresolved: ['e_x'],
      truncated: [],
    });
    expect(c.omitted).toHaveLength(1);
    expect(c.refsUnresolved).toContain('e_x');
  });
});

describe('ArchitectureProposal', () => {
  it('options have supuestos, evidencias, and acciones (advisory until adopted)', () => {
    const o: ProposalOption = {
      id: 'opt_1',
      title: 'Add BFF',
      description: 'Reuse orders + billing',
      supuestos: ['no new auth'],
      evidencias: ['orders GET /orders/{id}'],
      acciones: ['scaffold bff service'],
    };
    ArchitectureProposal.parse({
      id: asProposalId('p_1'),
      assessmentId: asAssessmentId('a_1'),
      objetivo: 'add a BFF',
      options: [o],
    });
  });
});

describe('Publication', () => {
  it('PublicationState is PENDING | CONFIRMED | UNCERTAIN', () => {
    for (const s of ['PENDING', 'CONFIRMED', 'UNCERTAIN'] as const) {
      expect(PublicationState.parse(s)).toBe(s);
    }
  });
  it('Publication carries a stable marker (for reconciliation)', () => {
    const p = Publication.parse({
      assessmentId: asAssessmentId('a_1'),
      target: 'orders',
      state: 'PENDING',
      marker: 'parallax-a_1-orders',
      updatedAt: 1700000000,
    });
    expect(p.marker).toMatch(/^parallax-/);
  });
});
