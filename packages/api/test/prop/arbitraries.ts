import fc from 'fast-check';
import { arbRepoName, arbSha } from '@parallax/shared/test/prop-arbitraries';
import type { LainCoverage, Manifest } from '../../src/coverage.js';
import type { ResolvedAssessmentRequest } from '../../src/worker/assessment-worker.js';
import { AssessmentStatus, type DigestInput } from '../../src/worker/state.js';

export const arbStatus = fc.constantFrom(...AssessmentStatus.options);

export const arbRepoMap = fc.dictionary(arbRepoName, arbSha, { maxKeys: 4 });

export const arbDigestInput: fc.Arbitrary<DigestInput> = fc
  .record({
    base: arbRepoMap,
    head: arbRepoMap,
    configHash: fc.oneof(fc.constant(null), arbSha),
    analyzerVersion: fc.string({ minLength: 1, maxLength: 12 }),
    policyVersion: fc.string({ minLength: 1, maxLength: 4 }),
  })
  .map((r) => ({
    manifest: { base: r.base, head: r.head },
    configHash: r.configHash,
    analyzerVersion: r.analyzerVersion,
    policyVersion: r.policyVersion,
  }));

const arbCoverageEntry = fc.oneof(
  arbRepoName,
  fc.record({ repo: arbRepoName, reason: fc.string({ maxLength: 12 }) }),
);

const arbReviewedEntry = fc.oneof(
  arbRepoName,
  fc.record({ repo: arbRepoName, commit: arbSha, dirty: fc.boolean() }),
);

export const arbLainCoverage: fc.Arbitrary<LainCoverage> = fc
  .record({
    complete: fc.boolean(),
    configured_only: fc.boolean(),
    reviewed: fc.array(arbReviewedEntry, { maxLength: 5 }),
    unreviewed: fc.array(arbCoverageEntry, { maxLength: 4 }),
    excluded: fc.array(arbCoverageEntry, { maxLength: 4 }),
    failed: fc.array(arbCoverageEntry, { maxLength: 4 }),
  })
  .map((r) => ({
    complete: r.complete,
    scope: {
      configured_only: r.configured_only,
      reviewed: r.reviewed,
      unreviewed: r.unreviewed,
      excluded: r.excluded,
      failed: r.failed,
    },
  }));

export const arbManifest: fc.Arbitrary<Manifest> = fc.record({
  configured: fc.array(arbRepoName, { maxLength: 5 }),
  excluded: fc.array(arbRepoName, { maxLength: 3 }),
});

export const arbRequest: fc.Arbitrary<ResolvedAssessmentRequest> = fc
  .record({
    base: arbRepoMap,
    head: arbRepoMap,
    configured: fc.array(arbRepoName, { maxLength: 4 }),
    excluded: fc.array(arbRepoName, { maxLength: 2 }),
  })
  .map((r) => ({
    orgId: 'org_demo',
    manifest: {
      base: { repos: r.base },
      head: { repos: r.head },
      configured: r.configured,
      excluded: r.excluded.map((repo) => ({ repo, reason: 'excluded' })),
      configHash: null,
    },
  }));
