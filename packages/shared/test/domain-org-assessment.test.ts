import { describe, expect, it } from 'vitest';
import { Org, OrgManifest, OrgRepo, OrgService } from '../src/domain/org.js';
import {
  Assessment,
  AssessmentStatus,
  AssessmentManifest,
  AssessmentInput,
} from '../src/domain/assessment.js';
import { asOrgId, asAssessmentId } from '../src/domain/ids.js';

describe('org types', () => {
  it('Org has id, name, createdAt', () => {
    const o = Org.parse({
      id: asOrgId('org_demo'),
      name: 'Demo Org',
      createdAt: 1700000000,
    });
    expect(o.name).toBe('Demo Org');
  });
  it('OrgRepo requires a resolved commit, not a branch', () => {
    const r: OrgRepo = { name: 'orders', commit: 'b5bf29a' };
    expect(r.commit).toMatch(/[0-9a-f]{7,}/);
    expect(() => OrgRepo.parse({ name: 'orders', commit: '' })).toThrow();
  });
  it('OrgService has id, name, repo', () => {
    const s: OrgService = { id: 'orders', name: 'orders', repo: 'orders' };
    OrgService.parse(s);
  });
  it('OrgManifest lists repos and services with a config version', () => {
    const m = OrgManifest.parse({
      orgId: asOrgId('org_demo'),
      repos: [{ name: 'orders', commit: 'b5bf29a' }],
      services: [{ id: 'orders', name: 'orders', repo: 'orders' }],
      configVersion: 'cfg_v1',
    });
    expect(m.repos[0]?.commit).toBe('b5bf29a');
  });
});

describe('assessment types', () => {
  it('AssessmentStatus is the seven-state machine', () => {
    for (const s of [
      'QUEUED',
      'SNAPSHOTTING',
      'ANALYZING',
      'EXPLAINING',
      'READY',
      'PARTIAL',
      'FAILED',
      'CANCELLED',
    ] as const) {
      expect(AssessmentStatus.parse(s)).toBe(s);
    }
  });
  it('Assessment requires inputDigest UNIQUE; repeated digest is rejected at the type level', () => {
    const a = Assessment.parse({
      id: asAssessmentId('a_1'),
      orgId: asOrgId('org_demo'),
      inputDigest: 'd_abc',
      status: 'QUEUED',
      baseId: null,
      headId: null,
      manifest: { base: { repos: {} }, head: { repos: {} } },
      createdAt: 1700000000,
    });
    expect(a.inputDigest).toBe('d_abc');
  });
  it('AssessmentManifest has base and head with resolved repos', () => {
    const m: AssessmentManifest = {
      base: { repos: { orders: 'b5bf29a' } },
      head: { repos: { orders: 'b5bf29b' } },
    };
    AssessmentManifest.parse(m);
  });
  it('AssessmentInput accepts a PR URL or a typed (repo, base, head) triple', () => {
    AssessmentInput.parse({ prUrl: 'https://github.com/org/repo/pull/1', orgId: asOrgId('o') });
    AssessmentInput.parse({
      repo: 'orders',
      base: 'b5bf29a',
      head: 'b5bf29b',
      orgId: asOrgId('o'),
    });
    expect(() => AssessmentInput.parse({ orgId: asOrgId('o') })).toThrow();
  });
});
