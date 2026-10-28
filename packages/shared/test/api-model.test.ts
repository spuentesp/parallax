import { describe, expect, it } from 'vitest';
import {
  AssessmentFindingSchema,
  AssessmentReportSchema,
  AssessmentSummarySchema,
} from '../src/domain/api-model.js';

describe('API contract schemas (single source of truth)', () => {
  it('accepts the canonical report shape', () => {
    const report = {
      id: 'a_1',
      orgId: 'org_demo',
      inputDigest: 'sha256_abc',
      status: 'READY',
      baseId: 'snap_base',
      headId: 'snap_head',
      manifest: { base: { repos: {} }, head: { repos: {} } },
      findings: [
        {
          kind: 'FieldRemoved',
          service: 'orders',
          field: 'customer_id',
          impact: { class: 'Verified', reasons: ['removed field'] },
        },
      ],
      engine: { analyzerVersion: '0.9.1' },
      coverage: {
        complete: false,
        summary: 'cobertura incompleta',
        scope: { reviewed: ['orders'], unreviewed: [{ repo: 'legacy', reason: 'excluded' }] },
      },
      evidence: [
        {
          id: 'ev_1',
          viewId: 'snap_head',
          repo: 'orders',
          sha: 'abc1234',
          path: 'src/x.ts',
          range: null,
          hash: 'h',
        },
      ],
      explanation: { status: 'available', revision: 0, model: 'm' },
      createdAt: 1,
      completedAt: 2,
    };
    expect(AssessmentReportSchema.parse(report)).toBeTruthy();
  });

  it('accepts both engine finding vocabularies (kind-based and endpoint-based)', () => {
    // El motor 0.9.1 emite {kind, service, field} y los helpers de
    // investigator consumen {endpoint, impact}: el contrato admite ambos
    // mientras la divergencia de vocabulario siga viva (seam documentado).
    expect(AssessmentFindingSchema.parse({ kind: 'FieldRemoved', service: 'orders' }).kind).toBe(
      'FieldRemoved',
    );
    const endpointStyle = AssessmentFindingSchema.parse({
      endpoint: { key: 'http:GET /orders', service: 'orders' },
      impact: { class: 'Verified' },
    });
    expect(endpointStyle.kind).toBe('');
    expect(endpointStyle.impact?.class).toBe('Verified');
  });

  it('accepts the summary shape consumed by the list view', () => {
    const summary = {
      id: 'a_1',
      orgId: 'org_demo',
      status: 'PARTIAL',
      findingCount: 3,
      inputDigest: 'sha256_abc',
      coverageComplete: false,
      coverageSummary: 'revisados: orders',
      createdAt: 1,
      completedAt: null,
    };
    expect(AssessmentSummarySchema.parse(summary)).toBeTruthy();
  });
});
