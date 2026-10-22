# Anti-Reward-Hacking Test Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-layer verification stack to parallax — property-based + differential tests over the pure core (fast-check), stateful/concurrency tests on `AssessmentWorker` (`fc.commands` / `fc.scheduler`), a held-out composition suite outside the implementer's edit scope, and an incremental StrykerJS mutation gate over the PR diff — so green visible tests can no longer hide hardcoding or feature isolation.

**Architecture:** Layers 1–2 live in `packages/*/test/prop/` and run inside `pnpm test` (the agent-visible `T_val`): generators and brute-force oracles replace static examples over the pure modules, and model-based/stateful sequences drive the real `AssessmentWorker` (SQLite + instant-snapshot adapter stub) against spec-level invariants. Layer 3 is a held-out suite (`packages/*/test-heldout/`, `T_test`) run only by `pnpm test:heldout` in its own CI job, guarded by `@parallax/gates` so one changeset cannot touch both implementation and oracle. Layer 4 is a StrykerJS mutation gate (`@parallax/gates` CLI) that mutates only files changed in the PR and blocks the merge when mutants survive outside `mutation-allowlist.json`. The red-team protocol (`docs/testing/`) defines the adversarial agent that owns `test-heldout/` and kills survivors.

**Tech Stack:** fast-check 4.10.2, @stryker-mutator/core 10.0.0, @stryker-mutator/vitest-runner 10.0.0 (peer `vitest >=2`), Vitest 5.0.4, tsx 4.20.0, Node 24.21.0, pnpm 12.11.2, Biome 2.5.15.

**Spec:** user brief of 2026-10-15 (anti-reward-hacking verification stack: held-out suites à la SpecBench, generators + oracles, incremental mutation gate, adversarial red-team role). Binding values are transcribed in Global Constraints. Domain invariants (INV 2, INV 3, INV 4, INV 5, P08) come from `docs/superpowers/specs/2026-10-13-parallax-foundation-design.md` and the comments in `packages/api/src/worker/*`. **The plan argues from the spec; the executor reads both.**

## Global Constraints

- **Node.js**: 24.21.0 (`.nvmrc`, `engines.node: ">=24.21.0"`). **pnpm**: 12.11.2. **TypeScript**: 7.0.2 with the strict flags of `tsconfig.base.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, …). **Biome**: 100 cols, single quotes, trailing commas, semicolons; `pnpm lint` and `pnpm format:check` must pass on every task.
- **Package conventions**: ESM ("type": "module"), relative imports carry the `.js` suffix (NodeNext in `api`/`gates`), test imports use `from '../src/<mod>.js'`. New package `@parallax/gates` follows the `packages/api` layout (`tsconfig.json` extends `../../tsconfig.base.json`, scripts `typecheck`/`test`).
- **Test naming**: unit + property tests in `packages/*/test/**/*.test.ts` (property files use the suffix `*.prop.test.ts` and live under `test/prop/`); held-out composition tests in `packages/*/test-heldout/**/*.heldout.test.ts`. `packages/*/vitest.config.ts` must never match `test-heldout/**`.
- **fast-check discipline**: every `fc.assert` call passes `fcDefaults()` from `packages/api/test/prop/harness.ts` (`numRuns` from env `FC_RUNS`, default 100; optional `FC_SEED` for replay; `endOnFailure: true`). Stateful/scheduler suites use `numRuns: 20–25` (they build a real temp SQLite per run) — pass that explicitly as `fcDefaults({ numRuns: 20 })`.
- **TDD cycle for property tasks** (implementation already exists): write the property → run it (green) → **teeth check**: plant the mutant named in the step, run, confirm the property FAILS, revert the mutant → run again (green) → commit. New modules (arbitraries, gates) use classic red-green: failing test first.
- **Held-out rule (the oracle is not editable by the implementer)**: a changeset that touches `packages/*/src/**` or `packages/*/test/**` AND `packages/*/test-heldout/**` is a CI failure (`@parallax/gates` separation guard). Held-out tests change only in `red-team:`-prefixed changesets that touch no implementation files.
- **Mutation gate policy**: StrykerJS runs only over `packages/*/src/**/*.ts` changed in the PR (`git diff --name-only origin/main...HEAD`), with `--incremental`. Note on granularity: Stryker mutates whole changed *files* (it cannot restrict to changed *lines*); `--incremental` narrows execution to mutants that differ from the stored baseline, which is the closest faithful approximation of "mutation testing on the diff". A mutant with status `Survived` or `NoCoverage` blocks the merge unless listed in `mutation-allowlist.json` with a non-empty `reason` (equivalent mutants).
- **Runtime budget**: property suites must finish in < 60s per package; the stateful/scheduler suites use `createInstantLain()` (no `sleep` in `awaitSnapshot`) so no test waits on real timers.
- **Commits**: small, focused, English, format `type(scope): subject` (e.g. `test(api): add digest properties`). One commit per task. Red-team changesets use `red-team(test-heldout): …`.
- **Coverage**: existing 60% v8 thresholds per package must not regress; `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` stay green at every commit.

## Review Focus

The five failure modes this stack implies but no single task's tests fully exercise, most likely first. Each is pinned to the task that owns it.

1. **Degenerate generators** — properties that only see short ASCII strings or one-key objects pass against hardcoded implementations, which is exactly the disease this stack treats. → Tasks 2–6 include a teeth check (planted mutant must fail the property) and `arbitraries.ts` uses bounded but multi-shape generators (dictionaries with up to 6 keys, JSON values, hex SHAs of length 7–40).
2. **Scheduler tests that do not interleave** — a `fc.scheduler` property whose assertions hold trivially (or that blocks on the worker's real 200ms snapshot poll) gives false confidence or flakes on CI. → Task 8 asserts the scheduled seam is actually used (`getLain` wrapped with `sched.scheduleFunction`) and runs against `createInstantLain()`; its teeth check removes the `inFlight` dedupe and expects duplicate event seqs.
3. **Held-out leakage** — if `pnpm test` also runs `test-heldout/`, or one PR tunes `src/` against the oracle, the separation is theater. → Task 9 tests `evaluateDiff` (including the red-team-only and implementer-only cases) and Task 10 adds a step that proves `pnpm test` does not list any `*.heldout.test.ts` file.
4. **Equivalent mutants blocking every PR** — a gate nobody can satisfy gets disabled. → Task 13 requires `reason` on every allowlist entry, reports allowlisted survivors separately from blocked ones, and starts Stryker `thresholds.break` at 0 (the gate script decides, with an explicit report).
5. **Tautological model-based tests** — a model that mirrors `TRANSITIONS` byte-for-byte passes even if the worker violates the spec. → Task 7's model encodes spec-level invariants only (idempotent create, terminal records never re-run, legal transitions in the event log, monotonic seqs), never the exact terminal status the implementation picks (`READY` vs `PARTIAL`).

---

### Task 1: fast-check harness + arbitraries (shared & api)

**Files:**
- Modify: `packages/shared/package.json` (devDep `fast-check: "4.10.2"`, export `./test/prop-arbitraries`)
- Modify: `packages/api/package.json` (devDep `fast-check: "4.10.2"`)
- Create: `packages/shared/test/prop/arbitraries.ts`
- Create: `packages/api/test/prop/arbitraries.ts`
- Create: `packages/api/test/prop/harness.ts`
- Test: `packages/shared/test/prop/paginate.prop.test.ts`

**Interfaces:**
- Consumes: `paginate<T>(items: T[], offset: number, limit: number): Page<T>` (`packages/shared/src/lain/evidence.ts`), `Page<T> = { items: T[]; nextCursor: string | null; truncated: boolean }`.
- Produces (for Tasks 2–8): `@parallax/shared/test/prop-arbitraries` → `arbText`, `arbRepoName`, `arbSha`, `arbJson`; `packages/api/test/prop/arbitraries.ts` → `arbStatus: fc.Arbitrary<AssessmentStatus>`, `arbRepoMap: fc.Arbitrary<Record<string, string>>`, `arbDigestInput: fc.Arbitrary<DigestInput>`, `arbManifest: fc.Arbitrary<Manifest>`, `arbLainCoverage: fc.Arbitrary<LainCoverage>`, `arbRequest: fc.Arbitrary<ResolvedAssessmentRequest>`; `packages/api/test/prop/harness.ts` → `fcDefaults(extra?: { numRuns?: number }): { numRuns: number; endOnFailure: boolean; seed?: number }`.

- [ ] **Step 1: Write the failing property test**

Create `packages/shared/test/prop/paginate.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/lain/evidence.js';

// Oráculo: paginar es cortar. La concatenación de todas las páginas debe
// reconstruir la lista original (contrato de cursor completo).
describe('paginate properties', () => {
  it('walking every page via nextCursor reproduces the input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.integer({ min: 1, max: 25 }),
        (items, limit) => {
          const collected: number[] = [];
          let cursor: string | null = '0';
          let guard = 0;
          while (cursor !== null && guard < 100) {
            const page = paginate(items, Number(cursor), limit);
            collected.push(...page.items);
            expect(page.items.length).toBeLessThanOrEqual(limit);
            expect(page.truncated).toBe(page.nextCursor !== null);
            cursor = page.nextCursor;
            guard += 1;
          }
          expect(collected).toEqual(items);
        },
      ),
      { numRuns: 50, endOnFailure: true },
    );
  });

  it('offset beyond the end yields an empty, non-truncated page', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 10 }), (items) => {
        const page = paginate(items, items.length + 5, 10);
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeNull();
        expect(page.truncated).toBe(false);
      }),
      { numRuns: 50, endOnFailure: true },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @parallax/shared run test -- test/prop/paginate.prop.test.ts`
Expected: FAIL with `Cannot find package 'fast-check'` (dependency not installed).

- [ ] **Step 3: Install fast-check and write the arbitraries + harness**

```bash
pnpm --filter @parallax/shared add -D fast-check@4.10.2
pnpm --filter @parallax/api add -D fast-check@4.10.2
```

Create `packages/shared/test/prop/arbitraries.ts`:

```ts
import fc from 'fast-check';

/** Cadenas arbitrarias; se usa para textos donde sólo importa la estructura. */
export const arbText = fc.string({ maxLength: 60 });

/** Nombres de repo estilo LAIN: [a-z0-9-], 1..16 chars. */
export const arbRepoName = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 16,
  })
  .map((chars) => chars.join(''));

/** SHAs hex de 7..40 chars (v4 de fast-check ya no trae `hexaString`). */
export const arbSha = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 7, maxLength: 40 })
  .map((chars) => chars.join(''));

/** Valores JSON seguros (sin undefined), para canonicalJson. */
export const arbJson = fc.jsonValue();
```

Edit `packages/shared/package.json`: add to `"exports"`:

```json
"./test/prop-arbitraries": "./test/prop/arbitraries.ts"
```

Create `packages/api/test/prop/harness.ts`:

```ts
/**
 * Parámetros reproducibles para todas las propiedades: FC_RUNS ajusta el
 * número de corridas y FC_SEED permite reproducir un contraejemplo concreto
 * (fast-check imprime el seed en cada fallo).
 */
export function fcDefaults(extra: { numRuns?: number } = {}): {
  numRuns: number;
  endOnFailure: boolean;
  seed?: number;
} {
  const base = { numRuns: extra.numRuns ?? Number(process.env.FC_RUNS ?? 100), endOnFailure: true };
  const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
  return seed === undefined ? base : { ...base, seed };
}
```

Create `packages/api/test/prop/arbitraries.ts`:

```ts
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
```

Note on types: `arbDigestInput` always provides `configHash` and `policyVersion` (as `null`/string or string) so `exactOptionalPropertyTypes` stays happy — the "omitted vs null" behavior is pinned by a named test in Task 2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @parallax/shared run test -- test/prop/paginate.prop.test.ts`
Expected: PASS (2 properties).

- [ ] **Step 5: Verify nothing else broke, then commit**

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
git add packages/shared/package.json packages/shared/test/prop packages/api/package.json packages/api/test/prop pnpm-lock.yaml
git commit -m "test: add fast-check harness and shared arbitraries"
```

---

### Task 2: Properties for `canonicalJson` / `computeInputDigest` (INV 4)

**Files:**
- Create: `packages/api/test/prop/state-digest.prop.test.ts`
- Test: `packages/api/test/prop/state-digest.prop.test.ts`

**Interfaces:**
- Consumes: `canonicalJson(value: unknown): string`, `computeInputDigest(input: DigestInput): string` (`packages/api/src/worker/state.ts:75,88`), `arbDigestInput`, `arbJson`, `fcDefaults` (Task 1).
- Produces: nothing (tests only).

- [ ] **Step 1: Write the property suite**

Create `packages/api/test/prop/state-digest.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, computeInputDigest, type DigestInput } from '../../src/worker/state.js';
import { arbDigestInput, arbJson } from './arbitraries.js';
import { fcDefaults } from './harness.js';

describe('canonicalJson properties', () => {
  it('is independent of key insertion order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), arbJson, { maxKeys: 6 }),
        (dict) => {
          const reversed: Record<string, unknown> = {};
          for (const key of Object.keys(dict).reverse()) reversed[key] = dict[key];
          expect(canonicalJson(reversed)).toBe(canonicalJson(dict));
        },
      ),
      fcDefaults(),
    );
  });

  it('round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(arbJson, (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(value);
      }),
      fcDefaults(),
    );
  });
});

describe('computeInputDigest properties (INV 4)', () => {
  it('is stable: same input, same digest', () => {
    fc.assert(
      fc.property(arbDigestInput, (input) => {
        expect(computeInputDigest(input)).toBe(computeInputDigest(input));
      }),
      fcDefaults(),
    );
  });

  it('is sensitive: a new head repo changes the digest', () => {
    fc.assert(
      fc.property(arbDigestInput, (input) => {
        const changed: DigestInput = {
          ...input,
          manifest: { ...input.manifest, head: { ...input.manifest.head, 'ZZ-extra': 'ff' } },
        };
        expect(computeInputDigest(changed)).not.toBe(computeInputDigest(input));
      }),
      fcDefaults(),
    );
  });

  it('formats as sha256_<64 hex>', () => {
    fc.assert(
      fc.property(arbDigestInput, (input) => {
        expect(computeInputDigest(input)).toMatch(/^sha256_[0-9a-f]{64}$/);
      }),
      fcDefaults(),
    );
  });

  it('treats an omitted configHash like an explicit null', () => {
    fc.assert(
      fc.property(arbDigestInput, (input) => {
        const withUndefined: DigestInput = {
          manifest: input.manifest,
          analyzerVersion: input.analyzerVersion,
          policyVersion: input.policyVersion,
        };
        const withNull: DigestInput = { ...input, configHash: null };
        expect(computeInputDigest(withUndefined)).toBe(computeInputDigest(withNull));
      }),
      fcDefaults(),
    );
  });
});
```

- [ ] **Step 2: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/state-digest.prop.test.ts`
Expected: PASS (6 properties).

- [ ] **Step 3: Teeth check — plant a mutant, expect FAIL, revert**

Edit `packages/api/src/worker/state.ts` line 79: change `.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))` to `.sort(() => 0)` (sort disabled). Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/state-digest.prop.test.ts`
Expected: FAIL on "is independent of key insertion order" with a counterexample and printed seed.

Revert the mutant (restore the original comparator). Run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/prop/state-digest.prop.test.ts
git commit -m "test(api): add canonicalJson and digest properties"
```

---

### Task 3: State-machine laws (`TRANSITIONS` / `canTransition` / `isTerminal`) + enum drift

**Files:**
- Create: `packages/api/test/prop/state-machine.prop.test.ts`
- Test: `packages/api/test/prop/state-machine.prop.test.ts`

**Interfaces:**
- Consumes: `AssessmentStatus` (zod enum), `TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]>`, `canTransition(from, to): boolean`, `isTerminal(status): boolean` (`packages/api/src/worker/state.ts:5-35`); `AssessmentStatus as SharedAssessmentStatus` from `@parallax/shared/domain` (the duplicated definition — feature-isolation drift between the two is exactly what this task pins); `arbStatus`, `fcDefaults` (Task 1).
- Produces: nothing (tests only).

- [ ] **Step 1: Write the property suite**

Create `packages/api/test/prop/state-machine.prop.test.ts`:

```ts
import fc from 'fast-check';
import { AssessmentStatus as SharedAssessmentStatus } from '@parallax/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  AssessmentStatus,
  TRANSITIONS,
  canTransition,
  isTerminal,
} from '../../src/worker/state.js';
import { arbStatus } from './arbitraries.js';
import { fcDefaults } from './harness.js';

const statuses = AssessmentStatus.options;

describe('state machine laws', () => {
  it('isTerminal(s) iff TRANSITIONS[s] has no exits', () => {
    for (const s of statuses) {
      expect(isTerminal(s)).toBe(TRANSITIONS[s].length === 0);
    }
  });

  it('no state transitions to itself and every target is a valid status', () => {
    fc.assert(
      fc.property(arbStatus, (s) => {
        expect(canTransition(s, s)).toBe(false);
        for (const target of TRANSITIONS[s]) {
          expect(statuses).toContain(target);
        }
      }),
      fcDefaults(),
    );
  });

  it('every non-terminal state reaches a terminal state (liveness)', () => {
    for (const s of statuses) {
      const seen = new Set<string>([s]);
      const queue = [...TRANSITIONS[s]];
      let reachesTerminal = isTerminal(s);
      while (queue.length > 0) {
        const next = queue.shift() as (typeof statuses)[number];
        if (isTerminal(next)) {
          reachesTerminal = true;
          break;
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(...TRANSITIONS[next]);
        }
      }
      expect(reachesTerminal).toBe(true);
    }
  });

  it('nothing transitions back into QUEUED (single entry state)', () => {
    for (const s of statuses) {
      expect(canTransition(s, 'QUEUED')).toBe(false);
    }
  });

  it('READY is only reachable through EXPLAINING', () => {
    for (const s of statuses) {
      if (s !== 'EXPLAINING') expect(canTransition(s, 'READY')).toBe(false);
    }
    expect(canTransition('EXPLAINING', 'READY')).toBe(true);
  });

  it('the documented happy path is a legal transition chain', () => {
    const chain = ['QUEUED', 'SNAPSHOTTING', 'ANALYZING', 'EXPLAINING', 'READY'] as const;
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i]!, chain[i + 1]!)).toBe(true);
    }
  });

  it('shared and api AssessmentStatus enums define the same values', () => {
    expect([...SharedAssessmentStatus.options].sort()).toEqual([...AssessmentStatus.options].sort());
  });
});
```

- [ ] **Step 2: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/state-machine.prop.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Teeth check — plant a mutant, expect FAIL, revert**

Edit `packages/api/src/worker/state.ts:21`: change `ANALYZING: ['EXPLAINING', 'PARTIAL', 'FAILED', 'CANCELLED']` to `ANALYZING: ['PARTIAL', 'FAILED', 'CANCELLED']` (the analyze→explain edge disappears). Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/state-machine.prop.test.ts`
Expected: FAIL on "the documented happy path is a legal transition chain" (`canTransition('ANALYZING', 'EXPLAINING')` expected true).

Revert the mutant (restore `'EXPLAINING'` in the list). Run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/prop/state-machine.prop.test.ts
git commit -m "test(api): pin state machine laws and enum agreement"
```

---

### Task 4: Properties for `presentCoverage` (INV 3)

**Files:**
- Create: `packages/api/test/prop/coverage.prop.test.ts`
- Test: `packages/api/test/prop/coverage.prop.test.ts`

**Interfaces:**
- Consumes: `presentCoverage(lain: LainCoverage, manifest: Manifest): PresentedCoverage` (`packages/api/src/coverage.ts:62`), `PresentedCoverage = { complete, scope: { configured_only, reviewed: string[], unreviewed: CoverageRepoNote[], excluded: CoverageRepoNote[] }, summary: string, raw: LainCoverage }`, `arbLainCoverage`, `arbManifest` (Task 1).
- Produces: nothing (tests only).

- [ ] **Step 1: Write the property suite**

Create `packages/api/test/prop/coverage.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { presentCoverage } from '../../src/coverage.js';
import { arbLainCoverage, arbManifest } from './arbitraries.js';
import { fcDefaults } from './harness.js';

describe('presentCoverage properties (INV 3)', () => {
  it('an excluded repo never appears as reviewed', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain, manifest) => {
        const presented = presentCoverage(lain, manifest);
        for (const repo of manifest.excluded) {
          expect(presented.scope.reviewed).not.toContain(repo);
        }
      }),
      fcDefaults(),
    );
  });

  it('complete is true only when the engine said so and nothing is left out', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain, manifest) => {
        const presented = presentCoverage(lain, manifest);
        if (presented.complete) {
          expect(lain.complete ?? false).toBe(true);
          expect(presented.scope.unreviewed).toEqual([]);
        }
      }),
      fcDefaults(),
    );
  });

  it('every manifest exclusion is visible in scope.excluded', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain, manifest) => {
        const presented = presentCoverage(lain, manifest);
        expect(presented.scope.excluded.map((n) => n.repo).sort()).toEqual(
          [...manifest.excluded].sort(),
        );
      }),
      fcDefaults(),
    );
  });

  it('an incomplete coverage warns in the summary instead of claiming absence', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain, manifest) => {
        const presented = presentCoverage(lain, manifest);
        expect(presented.summary.length).toBeGreaterThan(0);
        if (!presented.complete) {
          expect(presented.summary).toContain('incompleta');
        } else {
          expect(presented.summary).toContain('cobertura completa');
        }
      }),
      fcDefaults(),
    );
  });

  it('reviewed contains no empty repo names and no duplicates', () => {
    fc.assert(
      fc.property(arbLainCoverage, arbManifest, (lain, manifest) => {
        const reviewed = presentCoverage(lain, manifest).scope.reviewed;
        for (const name of reviewed) expect(name.length).toBeGreaterThan(0);
        expect(new Set(reviewed).size).toBe(reviewed.length);
      }),
      fcDefaults(),
    );
  });
});
```

- [ ] **Step 2: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/coverage.prop.test.ts`
Expected: PASS (5 properties).

- [ ] **Step 3: Teeth check — plant a mutant, expect FAIL, revert**

Edit `packages/api/src/coverage.ts:68`: remove `&& !excludedSet.has(repo)` from the reviewed filter. Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/coverage.prop.test.ts`
Expected: FAIL on "an excluded repo never appears as reviewed" (the generator will produce an overlap between `lain.scope.reviewed` and `manifest.excluded`).

Revert the mutant. Run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/prop/coverage.prop.test.ts
git commit -m "test(api): add presentCoverage invariant properties"
```

---

### Task 5: Pure graph/topology helpers + differential oracle for `resolveServiceForPath`

**Files:**
- Create: `packages/api/test/prop/graph.prop.test.ts`
- Test: `packages/api/test/prop/graph.prop.test.ts`

**Interfaces:**
- Consumes: `classifyNode(type: string): CodeNodeKind` (`packages/api/src/code-graph.ts:122`), `deriveLainRepoId(repo: { uri: string; local?: string | null }): string` (`packages/api/src/code-graph.ts:307`), `resolveServiceForPath(path: string | undefined, index: ReadonlyMap<string, readonly string[]>): string | null` (`packages/api/src/topology.ts`), `arbRepoName`, `arbText`, `fcDefaults`.
- Produces: nothing (tests only). The brute-force oracle lives inside this test file.

- [ ] **Step 1: Write the property suite with the independent oracle**

Create `packages/api/test/prop/graph.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyNode, deriveLainRepoId } from '../../src/code-graph.js';
import { resolveServiceForPath } from '../../src/topology.js';
import { arbRepoName, arbText } from '@parallax/shared/test/prop-arbitraries';
import { fcDefaults } from './harness.js';

const KINDS = ['container', 'symbol', 'route', 'schema', 'other'] as const;

// Oráculo de fuerza bruta, independiente de la implementación: recorre las
// longitudes de prefijo de mayor a menor (semántica "el prefijo más largo
// gana") en lugar de rastrear el mejor candidato incrementalmente.
function resolveOracle(
  path: string,
  index: ReadonlyMap<string, readonly string[]>,
): string | null {
  for (let len = path.length; len > 0; len--) {
    const prefix = path.slice(0, len);
    for (const [service, paths] of index) {
      if (paths.includes(prefix)) return service;
    }
  }
  return null;
}

const arbIndex = fc
  .dictionary(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.array(fc.stringMatching(/^[a-z/]{1,12}$/), { minLength: 1, maxLength: 3 }),
    { maxKeys: 4 },
  )
  .map((dict) => new Map(Object.entries(dict)));

describe('classifyNode properties', () => {
  it('is total and stable: any string maps to a valid kind', () => {
    fc.assert(
      fc.property(arbText, (type) => {
        const kind = classifyNode(type);
        expect(KINDS).toContain(kind);
        expect(classifyNode(type)).toBe(kind);
      }),
      fcDefaults(),
    );
  });

  it('maps the documented type names to their kind', () => {
    const table: Array<[string, (typeof KINDS)[number]]> = [
      ['File', 'container'],
      ['Namespace', 'container'],
      ['HttpRoute', 'route'],
      ['Schema', 'schema'],
      ['Function', 'symbol'],
      ['TotallyUnknownType', 'other'],
    ];
    for (const [type, kind] of table) {
      expect(classifyNode(type)).toBe(kind);
    }
  });
});

describe('deriveLainRepoId properties', () => {
  it('returns the last path segment without .git, normalizing backslashes', () => {
    fc.assert(
      fc.property(arbRepoName, arbRepoName, (a, b) => {
        expect(deriveLainRepoId({ uri: `x/${a}/${b}.git` })).toBe(b);
        expect(deriveLainRepoId({ uri: `x\\${a}\\${b}.git` })).toBe(b);
      }),
      fcDefaults(),
    );
  });

  it('local checkout wins over uri when present and non-empty', () => {
    fc.assert(
      fc.property(arbRepoName, arbRepoName, (localName, uriName) => {
        expect(
          deriveLainRepoId({ uri: `https://example.com/${uriName}.git`, local: `./test-repos/${localName}` }),
        ).toBe(localName);
        expect(deriveLainRepoId({ uri: `https://example.com/${uriName}.git`, local: '  ' })).toBe(
          uriName,
        );
      }),
      fcDefaults(),
    );
  });
});

describe('resolveServiceForPath properties (differential)', () => {
  it('matches the brute-force longest-prefix oracle', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z/]{1,16}$/), arbIndex, (path, index) => {
        expect(resolveServiceForPath(path, index)).toBe(resolveOracle(path, index));
      }),
      fcDefaults(),
    );
  });

  it('returns null for empty or undefined paths', () => {
    fc.assert(
      fc.property(arbIndex, (index) => {
        expect(resolveServiceForPath(undefined, index)).toBeNull();
        expect(resolveServiceForPath('', index)).toBeNull();
      }),
      fcDefaults(),
    );
  });

  it('is a pure function of the index (metamorphic: repeated calls agree)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z/]{1,16}$/), arbIndex, (path, index) => {
        expect(resolveServiceForPath(path, index)).toBe(resolveServiceForPath(path, index));
      }),
      fcDefaults(),
    );
  });
});
```

- [ ] **Step 2: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/graph.prop.test.ts`
Expected: PASS (7 properties).

- [ ] **Step 3: Teeth check — plant a mutant, expect FAIL, revert**

Edit `packages/api/src/topology.ts` in `resolveServiceForPath`: change `p.length > best.len` to `p.length < best.len` (prefix preference inverted). Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/graph.prop.test.ts`
Expected: FAIL on "matches the brute-force longest-prefix oracle" with a counterexample index+path.

Revert the mutant. Run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/prop/graph.prop.test.ts
git commit -m "test(api): add graph helper properties with differential oracle"
```

---

### Task 6: Investigator + advisor pure helpers (INV 2, no invented citations, masking)

**Files:**
- Create: `packages/api/test/prop/investigator.prop.test.ts`
- Create: `packages/api/test/prop/advisor.prop.test.ts`
- Test: both files

**Interfaces:**
- Consumes: `extractCitationRefs(answer: string, deliveredRefs?: readonly string[]): string[]`, `detectClassificationConflicts(answer: string, engineFindings: unknown[]): ClassificationConflict[]`, `serializeExplanation(result: InvestigationResult, opts: { question: string; endpointLabel?: string; engineFindings?: unknown[] }): ExplanationPayload` (`packages/api/src/agent/investigator.ts`); `maskGraphqlSource(text: string): string` (`packages/api/src/advisor/scan.ts`), `decodeGlobalId(id: string): DecodedGlobalId | null` (`packages/api/src/advisor/correlate.ts`) with `DecodedGlobalId = { repo, nodeType, path, name, line }`; `arbText`, `arbRepoName`, `arbSha` (Task 1), `fcDefaults`.
- Produces: nothing (tests only).

- [ ] **Step 1: Write the investigator property suite**

Create `packages/api/test/prop/investigator.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  detectClassificationConflicts,
  extractCitationRefs,
  serializeExplanation,
} from '../../src/agent/investigator.js';
import { arbSha, arbText } from '@parallax/shared/test/prop-arbitraries';
import { fcDefaults } from './harness.js';

describe('extractCitationRefs properties', () => {
  it('never throws and never duplicates refs', () => {
    fc.assert(
      fc.property(arbText, fc.array(arbText, { maxLength: 4 }), (answer, delivered) => {
        const refs = extractCitationRefs(answer, delivered);
        expect(new Set(refs).size).toBe(refs.length);
      }),
      fcDefaults(),
    );
  });

  it('never invents a ref: every ref appears in the answer or in deliveredRefs', () => {
    fc.assert(
      fc.property(arbText, fc.array(arbSha, { maxLength: 3 }), (answer, delivered) => {
        const refs = extractCitationRefs(answer, delivered);
        for (const ref of refs) {
          expect(answer.includes(ref) || delivered.includes(ref)).toBe(true);
        }
      }),
      fcDefaults(),
    );
  });

  it('extracts delivered ids that appear verbatim in the answer', () => {
    fc.assert(
      fc.property(arbSha, arbText, arbText, (id, before, after) => {
        const answer = `${before} ${id} ${after}`;
        expect(extractCitationRefs(answer, [id])).toContain(id);
      }),
      fcDefaults(),
    );
  });
});

describe('serializeExplanation properties (INV 2)', () => {
  it('copies engine finding classes verbatim, never renames them', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.stringMatching(/^[a-z:/.-]{3,20}$/),
            service: fc.stringMatching(/^[a-z]{1,10}$/),
            class: fc.constantFrom('Verified', 'NeedsInvestigation', 'NoKnownImpact'),
          }),
          { maxLength: 4 },
        ),
        arbText,
        (findings, answer) => {
          const engineFindings = findings.map((f) => ({
            endpoint: { key: f.key, service: f.service },
            impact: { class: f.class },
          }));
          const payload = serializeExplanation(
            {
              promptVersion: 'v1',
              effectiveModel: 'test-model',
              answer,
              citations: [],
              conflictingClaims: [],
              budget: { maxToolCalls: 8, toolCallsUsed: 0 },
              toolCallLog: [],
              modelLog: [],
              errors: [],
            } as never,
            { question: 'q', engineFindings },
          );
          expect(payload.engine_finding_classes.map((c) => c.class)).toEqual(
            findings.map((f) => f.class),
          );
          expect(payload.engine_finding_classes.map((c) => c.endpoint)).toEqual(
            findings.map((f) => f.key),
          );
        },
      ),
      fcDefaults(),
    );
  });

  it('drops malformed findings instead of inventing entries', () => {
    const payload = serializeExplanation(
      {
        promptVersion: 'v1',
        effectiveModel: 'm',
        answer: 'a',
        citations: [],
        conflictingClaims: [],
        budget: { maxToolCalls: 8, toolCallsUsed: 0 },
        toolCallLog: [],
        modelLog: [],
        errors: [],
      } as never,
      {
        question: 'q',
        engineFindings: [{}, { endpoint: {} }, { impact: { class: 'Verified' } }, null],
      },
    );
    expect(payload.engine_finding_classes).toEqual([]);
  });
});

describe('detectClassificationConflicts properties', () => {
  it('reported conflicts never claim the engine class itself', () => {
    fc.assert(
      fc.property(arbText, arbText, (sentence, key) => {
        const answer = `${key} is definitely NoKnownImpact. ${sentence}`;
        const conflicts = detectClassificationConflicts(answer, [
          { endpoint: { key, service: 'svc' }, impact: { class: 'Verified' } },
        ]);
        for (const c of conflicts) {
          expect(c.claimedClass).not.toBe(c.engineClass);
        }
      }),
      fcDefaults(),
    );
  });
});
```

Note: `serializeExplanation`'s `InvestigationResult` is cast with `as never` for the surplus fields the helper ignores; if the executor prefers, build the full `InvestigationResult` shape instead — the assertions only depend on `promptVersion`, `effectiveModel`, `answer`, `citations`, `conflictingClaims`, `budget`, `toolCallLog`, `modelLog`, `errors` and the `engine_finding_classes` output.

- [ ] **Step 2: Write the advisor property suite**

Create `packages/api/test/prop/advisor.prop.test.ts`:

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeGlobalId } from '../../src/advisor/correlate.js';
import { maskGraphqlSource } from '../../src/advisor/scan.js';
import { arbRepoName, arbText } from '@parallax/shared/test/prop-arbitraries';
import { fcDefaults } from './harness.js';

describe('maskGraphqlSource properties', () => {
  it('preserves length and newline positions', () => {
    fc.assert(
      fc.property(arbText, (text) => {
        const masked = maskGraphqlSource(text);
        expect(masked.length).toBe(text.length);
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '\n') expect(masked[i]).toBe('\n');
        }
      }),
      fcDefaults(),
    );
  });

  it('only blanks characters (every position is the original char or a space)', () => {
    fc.assert(
      fc.property(arbText, (text) => {
        const masked = maskGraphqlSource(text);
        for (let i = 0; i < text.length; i++) {
          expect(masked[i] === text[i] || masked[i] === ' ').toBe(true);
        }
      }),
      fcDefaults(),
    );
  });
});

describe('decodeGlobalId properties', () => {
  // Codificador local, independiente: repo:type:path:urlencoded-name:line
  function encodeGlobalId(parts: {
    repo: string;
    nodeType: string;
    path: string;
    name: string;
    line: number;
  }): string {
    return `${parts.repo}:${parts.nodeType}:${parts.path}:${encodeURIComponent(parts.name)}:${parts.line}`;
  }

  it('round-trips ids built by the reference encoder', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.constantFrom('Function', 'Class', 'HttpRoute'),
        fc.oneof(
          fc.stringMatching(/^[a-z/.]{1,16}$/),
          fc.stringMatching(/^[a-z]+:[a-z]+$/), // paths con ':' se re-arman al decodificar
        ),
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 100000 }),
        (repo, nodeType, path, name, line) => {
          const id = encodeGlobalId({ repo, nodeType, path, name, line });
          expect(decodeGlobalId(id)).toEqual({ repo, nodeType, path, name, line });
        },
      ),
      fcDefaults(),
    );
  });

  it('returns null or a complete shape for arbitrary strings, never throws', () => {
    fc.assert(
      fc.property(arbText, (id) => {
        const decoded = decodeGlobalId(id);
        if (decoded !== null) {
          expect(typeof decoded.repo).toBe('string');
          expect(typeof decoded.name).toBe('string');
          expect(Number.isFinite(decoded.line)).toBe(true);
        }
      }),
      fcDefaults(),
    );
  });
});
```

- [ ] **Step 3: Run both suites (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/investigator.prop.test.ts test/prop/advisor.prop.test.ts`
Expected: PASS (7 properties).

- [ ] **Step 4: Teeth check — plant mutants, expect FAIL, revert**

First mutant: in `packages/api/src/agent/investigator.ts` `extractCitationRefs`, add `push('fake-ref');` as the first statement of the function body. Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/investigator.prop.test.ts`
Expected: FAIL on "never invents a ref: every ref appears in the answer or in deliveredRefs". Revert.

Second mutant: in `packages/api/src/advisor/scan.ts` `maskGraphqlSource`, change the final `return out.join('')` to `return out.join('').slice(1)` (output length no longer preserved). Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/advisor.prop.test.ts`
Expected: FAIL on "preserves length and newline positions". Revert. Run both suites again: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/test/prop/investigator.prop.test.ts packages/api/test/prop/advisor.prop.test.ts
git commit -m "test(api): add investigator and advisor helper properties"
```

---

### Task 7: Instant-snapshot LainAdapter stub + stateful model-based tests (`fc.commands`)

**Files:**
- Create: `packages/api/test/prop/worker-lain-stub.ts`
- Create: `packages/api/test/prop/worker-stateful.prop.test.ts`
- Test: `packages/api/test/prop/worker-stateful.prop.test.ts`

**Interfaces:**
- Consumes: `AssessmentWorker` with `create(input: ResolvedAssessmentRequest): Promise<CreateResult>` (`CreateResult = { assessment: AssessmentRecord; created: boolean }`), `run(id: string): Promise<AssessmentRecord>`, `get(id: string): Promise<AssessmentRecord | null>`, `events(id: string): Promise<AssessmentEvent[]>`, `recover(): Promise<string[]>`, `drain(): Promise<void>`, `transition(id, to, extra?)` (`packages/api/src/worker/assessment-worker.ts`); `canTransition`, `isTerminal`, `canonicalJson` (`packages/api/src/worker/state.ts`); `createLainMock(): LainAdapter` (`packages/api/src/lain-adapter/mock.ts`); `arbRequest`, `fcDefaults` (Task 1).
- Produces (for Task 8 and Task 11): `createInstantLain(): LainAdapter` — mock that keeps `prepareSnapshot` (so scenario snapshot ids still work) but answers `getSnapshot` as `ready` immediately, so `awaitSnapshot` never sleeps; and `makeWorkerHarness(): Promise<{ worker, db, dir, cleanup }>` inside the test file (Task 11 copies the same pattern into `test-heldout/`).

- [ ] **Step 1: Write the failing test (consumer of the stub)**

Create `packages/api/test/prop/worker-stateful.prop.test.ts` with only the harness + first test (the stub module does not exist yet):

```ts
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { AssessmentWorker } from '../../src/worker/assessment-worker.js';
import { isTerminal } from '../../src/worker/state.js';
import { createInstantLain } from './worker-lain-stub.js';

const dirs: string[] = [];

async function makeWorkerHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-stateful-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../../drizzle'));
  const db = drizzle(sqlite, { schema });
  await db
    .insert(schema.workspace)
    .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  const worker = new AssessmentWorker(db, { getLain: async () => createInstantLain() });
  return { worker, db, dir };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('instant lain stub', () => {
  it('run() reaches a terminal status without sleeping on the snapshot poll', async () => {
    const { worker } = await makeWorkerHarness();
    const created = await worker.create({
      orgId: 'org_demo',
      manifest: {
        base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
        head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
        configured: ['orders'],
        excluded: [],
        configHash: null,
      },
    });
    const record = await worker.run(created.assessment.id);
    expect(isTerminal(record.status)).toBe(true);
    await worker.drain();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @parallax/api run test -- test/prop/worker-stateful.prop.test.ts`
Expected: FAIL with `Cannot find module './worker-lain-stub.js'`.

- [ ] **Step 3: Create the stub and add the stateful model-based suite (fc.commands)**

Create `packages/api/test/prop/worker-lain-stub.ts`:

```ts
import type {
  GetSnapshotArgs,
  GetSnapshotResponse,
  LainAdapter,
} from '../../src/lain-adapter/types.js';
import { createLainMock } from '../../src/lain-adapter/mock.js';

/**
 * Stub rápido para tests stateful: conserva prepareSnapshot del mock (los ids
 * de snapshot siguen eligiendo el escenario) pero responde getSnapshot como
 * 'ready' al instante, para que awaitSnapshot no duerma 200ms por vista.
 */
export function createInstantLain(): LainAdapter {
  const mock = createLainMock();
  return {
    ...mock,
    async getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse> {
      return { snapshot: req.snapshot, state: 'ready' };
    },
  };
}
```

Append to `packages/api/test/prop/worker-stateful.prop.test.ts` (also extend the imports with `type ResolvedAssessmentRequest`, `canonicalJson`, `arbRequest`, `fcDefaults`):

```ts
type Model = {
  byRequest: Map<string, string>; // canonicalJson(request) → assessmentId
  statusById: Map<string, string>;
  terminalIds: Set<string>;
};
type Real = Awaited<ReturnType<typeof makeWorkerHarness>>;

// El modelo codifica invariantes de nivel especificación (INV 4, INV 5 y el
// log de transiciones), NUNCA el status terminal exacto que elige la
// implementación (READY vs PARTIAL): eso sería un test tautológico.
class CreateCmd implements fc.AsyncCommand<Model, Real> {
  private readonly key: string;
  constructor(private readonly request: ResolvedAssessmentRequest) {
    this.key = canonicalJson(request);
  }
  check(): boolean {
    return true;
  }
  async run(model: Model, real: Real): Promise<void> {
    const result = await real.worker.create(this.request);
    if (model.byRequest.has(this.key)) {
      // INV 4: el mismo input devuelve el mismo assessment, created:false.
      expect(result.created).toBe(false);
      expect(result.assessment.id).toBe(model.byRequest.get(this.key));
    } else {
      expect(result.created).toBe(true);
      expect(result.assessment.status).toBe('QUEUED');
      model.byRequest.set(this.key, result.assessment.id);
      model.statusById.set(result.assessment.id, 'QUEUED');
    }
  }
  toString(): string {
    return `create(${Object.keys(this.request.manifest.head.repos).join(',')})`;
  }
}

class RunCmd implements fc.AsyncCommand<Model, Real> {
  check(model: Model): boolean {
    return [...model.statusById.values()].some((s) => s !== undefined && !isTerminal(s as never));
  }
  async run(model: Model, real: Real): Promise<void> {
    const open = [...model.statusById.entries()].find(([, s]) => !isTerminal(s as never));
    const id = open![0];
    const before = await real.worker.get(id);
    const record = await real.worker.run(id);
    // Invariante de spec: el run termina en un estado terminal.
    expect(isTerminal(record.status)).toBe(true);
    if (model.terminalIds.has(id)) {
      // INV 5: un registro terminal no se re-ejecuta (READY queda legible).
      expect(record.status).toBe(before!.status);
      expect(record.completedAt).toBe(before!.completedAt);
    }
    // Sólo transiciones legales en el log; seqs estrictamente crecientes y únicas.
    const events = await real.worker.events(id);
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    model.statusById.set(id, record.status);
    model.terminalIds.add(id);
  }
  toString(): string {
    return 'run()';
  }
}

class RecoverCmd implements fc.AsyncCommand<Model, Real> {
  check(model: Model): boolean {
    return model.byRequest.size > 0;
  }
  async run(model: Model, real: Real): Promise<void> {
    const resumed = await real.worker.recover();
    // Sólo se reanudan ids creados por este modelo (nunca ajenos).
    for (const id of resumed) {
      expect([...model.byRequest.values()]).toContain(id);
    }
  }
  toString(): string {
    return 'recover()';
  }
}

describe('AssessmentWorker stateful model-based properties', () => {
  it('holds INV 4 / INV 5 / legal event logs under generated command sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            arbRequest.map((input) => new CreateCmd(input) as fc.AsyncCommand<Model, Real>),
            fc.constant(new RunCmd() as fc.AsyncCommand<Model, Real>),
            fc.constant(new RecoverCmd() as fc.AsyncCommand<Model, Real>),
          ],
          { maxCommands: 6 },
        ),
        async (cmds) => {
          const real = await makeWorkerHarness();
          const model: Model = {
            byRequest: new Map(),
            statusById: new Map(),
            terminalIds: new Set(),
          };
          await fc.asyncModelRun(() => ({ model, real }), cmds);
          await real.worker.drain();
        },
      ),
      fcDefaults({ numRuns: 20 }),
    );
  });
});
```

Note: `statusById` values are `AssessmentStatus` strings; cast with `as never` keeps `isTerminal` typing simple — or type the map as `Map<string, AssessmentStatus>` and drop the casts.

- [ ] **Step 4: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/worker-stateful.prop.test.ts`
Expected: PASS (stub test + 20 sequences). Runtime < 30s (instant stub, `numRuns: 20`, `maxCommands: 6`).

- [ ] **Step 5: Commit**

```bash
git add packages/api/test/prop/worker-lain-stub.ts packages/api/test/prop/worker-stateful.prop.test.ts
git commit -m "test(api): add model-based stateful properties for AssessmentWorker"
```

---

### Task 8: Interleaving properties (`fc.scheduler`) for idempotency race and run re-entrancy

**Files:**
- Create: `packages/api/test/prop/worker-scheduler.prop.test.ts`
- Test: `packages/api/test/prop/worker-scheduler.prop.test.ts`

**Interfaces:**
- Consumes: `createInstantLain`, harness pattern of Task 7 (`makeWorkerHarness` is re-declared locally with an extra seam), `arbRequest`, `fcDefaults`; `AssessmentWorker.create/run/drain/events` and `isTerminal`.
- Produces: nothing (tests only).

- [ ] **Step 1: Write the scheduler property suite**

Create `packages/api/test/prop/worker-scheduler.prop.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import type { LainAdapter } from '../../src/lain-adapter/types.js';
import {
  AssessmentWorker,
  type ResolvedAssessmentRequest,
} from '../../src/worker/assessment-worker.js';
import { isTerminal } from '../../src/worker/state.js';
import { arbRequest } from './arbitraries.js';
import { fcDefaults } from './harness.js';
import { createInstantLain } from './worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-sched-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../../drizzle'));
  return drizzle(sqlite, { schema });
}

describe('AssessmentWorker interleaving properties', () => {
  it('concurrent create() with the same request: exactly one created (INV 4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), arbRequest, async (sched, request: ResolvedAssessmentRequest) => {
        const db = makeDb();
        await db
          .insert(schema.workspace)
          .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
        // El punto de intercalación es la costura inyectada getLain.
        const scheduledGetLain = sched.scheduleFunction(
          async (_orgId: string): Promise<LainAdapter> => createInstantLain(),
        );
        const worker = new AssessmentWorker(db, { getLain: scheduledGetLain });

        const [a, b] = await Promise.all([worker.create(request), worker.create(request)]);

        const createdCount = [a, b].filter((r) => r.created).length;
        expect(createdCount).toBe(1);
        expect(a.assessment.id).toBe(b.assessment.id);
        expect(a.assessment.status).toBe('QUEUED');
        await worker.drain();
      }),
      fcDefaults({ numRuns: 25 }),
    );
  });

  it('concurrent run() is single-execution and yields unique increasing event seqs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), arbRequest, async (sched, request: ResolvedAssessmentRequest) => {
        const db = makeDb();
        await db
          .insert(schema.workspace)
          .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
        const scheduledGetLain = sched.scheduleFunction(
          async (_orgId: string): Promise<LainAdapter> => createInstantLain(),
        );
        const worker = new AssessmentWorker(db, { getLain: scheduledGetLain });
        const created = await worker.create(request);

        const [r1, r2] = await Promise.all([
          worker.run(created.assessment.id),
          worker.run(created.assessment.id),
        ]);

        expect(r1.status).toBe(r2.status);
        expect(isTerminal(r1.status)).toBe(true);
        const events = await worker.events(created.assessment.id);
        const seqs = events.map((e) => e.seq);
        expect(new Set(seqs).size).toBe(seqs.length); // sin eventos duplicados
        expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
        await worker.drain();
      }),
      fcDefaults({ numRuns: 25 }),
    );
  });
});
```

- [ ] **Step 2: Run the suite (expect green)**

Run: `pnpm --filter @parallax/api run test -- test/prop/worker-scheduler.prop.test.ts`
Expected: PASS (2 properties × 25 interleavings). Runtime < 45s.

- [ ] **Step 3: Teeth check — plant a mutant, expect FAIL, revert**

Edit `packages/api/src/worker/assessment-worker.ts` in `run()`: remove the `inFlight` dedupe (delete the `const existing = this.inFlight.get(id); if (existing) return existing;` guard). Run:

Run: `pnpm --filter @parallax/api run test -- test/prop/worker-scheduler.prop.test.ts`
Expected: FAIL on "concurrent run() is single-execution…" (duplicate event seqs or divergent statuses once both executions interleave).

Revert the mutant. Run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/prop/worker-scheduler.prop.test.ts
git commit -m "test(api): add scheduler interleaving properties for worker races"
```

---

### Task 9: `@parallax/gates` package + held-out separation guard (TDD)

**Files:**
- Create: `packages/gates/package.json`
- Create: `packages/gates/tsconfig.json`
- Create: `packages/gates/src/heldout-separation.ts`
- Create: `packages/gates/src/cli/check-heldout-separation.ts`
- Create: `packages/gates/test/heldout-separation.test.ts`
- Modify: `vitest.workspace.ts` (add `'packages/gates'`)
- Modify: `package.json` (root script `gate:separation`)

**Interfaces:**
- Consumes: nothing (leaf tooling package).
- Produces (for Tasks 10–14): `evaluateDiff(files: readonly string[]): SeparationReport` with `SeparationReport = { implFiles: string[]; heldoutFiles: string[]; violation: boolean }` (violation ⇔ both sets non-empty); CLI `pnpm --filter @parallax/gates run gate:separation` reading `git diff --name-only <GATE_BASE>...HEAD` (env `GATE_BASE`, default `origin/main`), exit 1 on violation.

- [ ] **Step 1: Write the failing tests**

Create `packages/gates/test/heldout-separation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateDiff } from '../src/heldout-separation.js';

describe('evaluateDiff', () => {
  it('flags a changeset that touches both implementation and test-heldout', () => {
    const report = evaluateDiff([
      'packages/api/src/coverage.ts',
      'packages/api/test-heldout/lifecycle.heldout.test.ts',
    ]);
    expect(report.violation).toBe(true);
    expect(report.implFiles).toEqual(['packages/api/src/coverage.ts']);
    expect(report.heldoutFiles).toEqual(['packages/api/test-heldout/lifecycle.heldout.test.ts']);
  });

  it('allows held-out-only changesets (red-team PRs)', () => {
    const report = evaluateDiff([
      'packages/api/test-heldout/lifecycle.heldout.test.ts',
      'packages/shared/test-heldout/x.heldout.test.ts',
    ]);
    expect(report.violation).toBe(false);
  });

  it('allows implementation-only changesets (implementer PRs)', () => {
    const report = evaluateDiff([
      'packages/api/src/coverage.ts',
      'packages/api/test/prop/coverage.prop.test.ts',
    ]);
    expect(report.violation).toBe(false);
  });

  it('ignores docs, configs and unrelated paths', () => {
    const report = evaluateDiff(['docs/testing/red-team-protocol.md', 'package.json', 'README.md']);
    expect(report.violation).toBe(false);
    expect(report.implFiles).toEqual([]);
    expect(report.heldoutFiles).toEqual([]);
  });

  it('treats packages/gates/src as implementation (the guard is not self-exempt)', () => {
    const report = evaluateDiff([
      'packages/gates/src/heldout-separation.ts',
      'packages/api/test-heldout/x.heldout.test.ts',
    ]);
    expect(report.violation).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/gates run test`
Expected: FAIL — package `@parallax/gates` does not exist yet (`pnpm --filter` finds nothing / module not found). If `pnpm --filter` errors before running vitest, run `pnpm install` after Step 3 and confirm the tests fail against an empty implementation instead (a stub `export function evaluateDiff(): SeparationReport` returning empty sets also fails them — either red state is acceptable).

- [ ] **Step 3: Create the package and the minimal implementation (green)**

Create `packages/gates/package.json`:

```json
{
  "name": "@parallax/gates",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "gate:separation": "tsx src/cli/check-heldout-separation.ts",
    "gate:mutation": "tsx src/cli/mutation-gate.ts"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "tsx": "4.20.0",
    "typescript": "7.0.2",
    "vitest": "5.0.4"
  }
}
```

Create `packages/gates/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Create `packages/gates/src/heldout-separation.ts`:

```ts
export interface SeparationReport {
  implFiles: string[];
  heldoutFiles: string[];
  violation: boolean;
}

// El oráculo (test-heldout) vive fuera del alcance del agente que implementa:
// un mismo changeset no puede tocar implementación y oráculo a la vez.
const HELDOUT = /(^|\/)test-heldout\//;
const IMPL = /^packages\/[^/]+\/(src|test)\//;

export function evaluateDiff(files: readonly string[]): SeparationReport {
  const implFiles = files.filter((f) => IMPL.test(f) && !HELDOUT.test(f));
  const heldoutFiles = files.filter((f) => HELDOUT.test(f));
  return {
    implFiles,
    heldoutFiles,
    violation: implFiles.length > 0 && heldoutFiles.length > 0,
  };
}
```

Create `packages/gates/src/cli/check-heldout-separation.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { evaluateDiff } from '../heldout-separation.js';

const base = process.env.GATE_BASE ?? 'origin/main';

function changedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const report = evaluateDiff(changedFiles());
if (report.violation) {
  console.error('HELDOUT SEPARATION VIOLATION: un changeset toca implementación y test-heldout.');
  console.error(`  implementación: ${report.implFiles.join(', ')}`);
  console.error(`  held-out: ${report.heldoutFiles.join(', ')}`);
  console.error('  El oráculo de aceptación sólo cambia en changesets red-team (docs/testing/red-team-protocol.md).');
  process.exit(1);
}
console.log(
  `heldout-separation ok (${report.implFiles.length} impl, ${report.heldoutFiles.length} held-out)`,
);
```

Modify `vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/api',
  'packages/mcp',
  'packages/web',
  'packages/gates',
]);
```

Modify root `package.json` scripts: add `"gate:separation": "pnpm --filter @parallax/gates run gate:separation"`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm install
pnpm --filter @parallax/gates run test
```
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the CLI works against the real git diff, then commit**

```bash
GATE_BASE=HEAD~1 pnpm gate:separation   # prints "heldout-separation ok (...)"
pnpm typecheck && pnpm lint
git add packages/gates vitest.workspace.ts package.json pnpm-lock.yaml
git commit -m "feat(gates): add held-out separation guard"
```

---

### Task 10: Held-out suite infrastructure (configs, scripts, CI job)

**Files:**
- Create: `packages/api/test-heldout/.gitkeep` (dir marker until Task 11)
- Create: `packages/api/vitest.heldout.config.ts`
- Modify: `packages/api/package.json` (script `test:heldout`)
- Modify: `packages/api/tsconfig.json` (include `test-heldout/**/*`)
- Modify: `package.json` (root script `test:heldout`)
- Modify: `biome.json` (files.includes `packages/*/test-heldout/**`)
- Modify: `.github/workflows/ci.yml` (jobs `heldout` and `separation-guard`)

**Interfaces:**
- Consumes: `gate:separation` (Task 9).
- Produces: `pnpm test:heldout` (runs `vitest run --config vitest.heldout.config.ts` in `@parallax/api`), CI job `heldout` (separate from `validate`), CI job `separation-guard` (PR-only).

- [ ] **Step 1: Create the held-out vitest config and package script**

Create `packages/api/vitest.heldout.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Suite held-out (T_test): composición e invariantes de punta a punta. NO
// corre en `pnpm test` (el include de vitest.config.ts es test/** y src/**);
// corre sólo con `pnpm test:heldout`, en un job de CI propio.
export default defineConfig({
  test: {
    name: '@parallax/api-heldout',
    environment: 'node',
    include: ['test-heldout/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

Modify `packages/api/package.json` scripts: add `"test:heldout": "vitest run --config vitest.heldout.config.ts"`.
Modify root `package.json` scripts: add `"test:heldout": "pnpm --filter @parallax/api run test:heldout"`.
Modify `packages/api/tsconfig.json` `"include"` to `["src/**/*", "test/**/*", "test-heldout/**/*"]`.
Modify `biome.json` `"files".includes`: add `"packages/*/test-heldout/**"`.
Create `packages/api/test-heldout/.gitkeep` (empty).

- [ ] **Step 2: Prove the separation (the visible suite must not see held-out)**

Create a throwaway probe file `packages/api/test-heldout/probe.heldout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
describe('probe', () => {
  it('runs only under the held-out config', () => {
    expect(true).toBe(true);
  });
});
```

Run: `pnpm test 2>&1 | grep -c probe` — Expected: `0` (the visible suite never lists it).
Run: `pnpm test:heldout` — Expected: PASS (1 test, `@parallax/api-heldout` project).
Run: `pnpm typecheck && pnpm lint` — Expected: clean (proves tsconfig/biome include the new dirs).

- [ ] **Step 3: Wire the CI jobs**

Modify `.github/workflows/ci.yml`: add two jobs after `validate`:

```yaml
  heldout:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 12.11.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24.21.0
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Held-out composition suite
        run: pnpm test:heldout

  separation-guard:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 12.11.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24.21.0
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Held-out separation guard
        run: pnpm gate:separation
        env:
          GATE_BASE: origin/${{ github.base_ref }}
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/vitest.heldout.config.ts packages/api/package.json packages/api/tsconfig.json packages/api/test-heldout package.json biome.json .github/workflows/ci.yml
git commit -m "ci: add held-out suite runner and separation guard job"
```

---

### Task 11: Held-out composition tests (T_test — multi-feature chains)

**Files:**
- Create: `packages/api/test-heldout/lifecycle-composition.heldout.test.ts`
- Create: `packages/api/test-heldout/recovery-composition.heldout.test.ts`
- Create: `packages/api/test-heldout/explanation-separation.heldout.test.ts`
- Delete: `packages/api/test-heldout/probe.heldout.test.ts`
- Test: the three files above

**Interfaces:**
- Consumes: `AssessmentWorker` (Task 7 signatures), `getAssessmentReport(db, id): Promise<AssessmentApiModel | null>` (`packages/api/src/services/assessments.ts:311`), `buildCommentPreview(report: AssessmentApiModel, opts?): CommentPreview` (`packages/api/src/github/comment-preview.ts:51`, `CommentPreview.evaluated: { baseSha, headSha, assessmentId }`, `CommentPreview.coverage: { complete, reviewed, notReviewed, summary }`), `serializeExplanation`, `detectClassificationConflicts` (`packages/api/src/agent/investigator.ts`), `canTransition`, `isTerminal` (`packages/api/src/worker/state.ts`), `createLainMock`, `createInstantLain` (copy the stub inline or import from `../test/prop/worker-lain-stub.js`), `ExplainOutcome = { status: string; model: string; payload: unknown | null }`.
- Produces: nothing (tests only). These are the acceptance oracle the implementer agent cannot edit.

- [ ] **Step 1: Write the lifecycle composition test**

Create `packages/api/test-heldout/lifecycle-composition.heldout.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCommentPreview } from '../src/github/comment-preview.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { getAssessmentReport } from '../src/services/assessments.js';
import { AssessmentWorker } from '../src/worker/assessment-worker.js';
import { canTransition, isTerminal, type AssessmentStatus } from '../src/worker/state.js';
import { createInstantLain } from '../test/prop/worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../drizzle'));
  const db = drizzle(sqlite, { schema });
  await db
    .insert(schema.workspace)
    .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  const worker = new AssessmentWorker(db, { getLain: async () => createInstantLain() });
  return { worker, db, dir };
}

const REQUEST = {
  orgId: 'org_demo',
  manifest: {
    base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
    head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
    configured: ['orders'],
    excluded: [{ repo: 'legacy', reason: 'excluded' }],
    configHash: null,
  },
};

describe('composición: ciclo completo create → run → report → comment preview', () => {
  it('mantiene identidad, INV 3 e INV 4 a través de todas las capas', async () => {
    const { worker, db } = await makeHarness();

    // INV 4: el segundo create con el mismo input reutiliza el trabajo.
    const first = await worker.create(REQUEST);
    const second = await worker.create(REQUEST);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);

    const record = await worker.run(first.assessment.id);
    await worker.drain();
    expect(isTerminal(record.status)).toBe(true);
    expect(['READY', 'PARTIAL']).toContain(record.status);

    // El log de eventos sólo contiene transiciones legales, con seqs únicos.
    const events = await worker.events(first.assessment.id);
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // Composición con services + github: el informe y el preview coinciden.
    const report = await getAssessmentReport(db, first.assessment.id);
    expect(report).not.toBeNull();
    const preview = buildCommentPreview(report!);
    expect(preview.evaluated.assessmentId).toBe(first.assessment.id);
    expect(preview.markdown.length).toBeGreaterThan(0);

    // INV 3 visible en ambas capas: la exclusión nunca es "revisado".
    const coverage = report!.coverage as {
      complete: boolean;
      scope: { reviewed: string[]; excluded: Array<{ repo: string; reason: string }> };
    };
    expect(coverage.scope.reviewed).not.toContain('legacy');
    expect(coverage.scope.excluded.map((n) => n.repo)).toContain('legacy');
    expect(preview.coverage.notReviewed.map((n) => n.repo)).toContain('legacy');
  });
});
```

- [ ] **Step 2: Write the recovery composition test (INV 5)**

Create `packages/api/test-heldout/recovery-composition.heldout.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { AssessmentWorker } from '../src/worker/assessment-worker.js';
import { isTerminal } from '../src/worker/state.js';
import { createInstantLain } from '../test/prop/worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-recovery-'));
  dirs.push(dir);
  const sqlite = new Database(join(dir, 'test.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite, join(__dirname, '../drizzle'));
  const db = drizzle(sqlite, { schema });
  await db
    .insert(schema.workspace)
    .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });
  const worker = new AssessmentWorker(db, { getLain: async () => createInstantLain() });
  return { worker, db, dir };
}

const REQUEST = {
  orgId: 'org_demo',
  manifest: {
    base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
    head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
    configured: ['orders'],
    excluded: [],
    configHash: null,
  },
};

describe('composición: crash simulado → recover → READY legible', () => {
  it('reanuda trabajos no terminales y nunca re-ejecuta uno terminado', async () => {
    const { worker } = await makeHarness();
    const created = await worker.create(REQUEST);

    // Crash simulado: el trabajo queda en SNAPSHOTTING (no terminal).
    await worker.transition(created.assessment.id, 'SNAPSHOTTING');
    const resumed = await worker.recover();
    expect(resumed).toContain(created.assessment.id);

    const after = await worker.get(created.assessment.id);
    expect(isTerminal(after!.status)).toBe(true);

    // INV 5: un READY/PARTIAL legible no vuelve a ejecutarse.
    const completedAt = after!.completedAt;
    const resumedAgain = await worker.recover();
    expect(resumedAgain).not.toContain(created.assessment.id);
    const final = await worker.get(created.assessment.id);
    expect(final!.status).toBe(after!.status);
    expect(final!.completedAt).toBe(completedAt);
    await worker.drain();
  });
});
```

- [ ] **Step 3: Write the explanation-separation composition test (INV 2 / P08)**

Create `packages/api/test-heldout/explanation-separation.heldout.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { detectClassificationConflicts, serializeExplanation } from '../src/agent/investigator.js';
import { runMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { getAssessmentReport } from '../src/services/assessments.js';
import {
  AssessmentWorker,
  type ExplainOutcome,
} from '../src/worker/assessment-worker.js';
import { createInstantLain } from '../test/prop/worker-lain-stub.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const REQUEST = {
  orgId: 'org_demo',
  manifest: {
    base: { repos: { orders: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' } },
    head: { repos: { orders: 'afece2321df86647a31d073a2e3cadb50e13d42e' } },
    configured: ['orders'],
    excluded: [],
    configHash: null,
  },
};

describe('composición: el modelo nunca renombra las clases del motor (INV 2)', () => {
  it('persiste classes del motor verbatim y hace visible el desacuerdo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parallax-heldout-explain-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'test.db'));
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    runMigrations(sqlite, join(__dirname, '../drizzle'));
    const db = drizzle(sqlite, { schema });
    await db
      .insert(schema.workspace)
      .values({ id: 'org_demo', name: 'Demo', description: null, createdAt: Date.now() });

    // El explain inyectado recibe los findings del motor y devuelve un payload
    // cuya narrativa DISCREPA del motor (el modelo afirma NoKnownImpact).
    let capturedEngineFindings: unknown[] = [];
    const explain = async (args: {
      orgId: string;
      viewId: string;
      question: string;
      engineFindings: unknown[];
    }): Promise<ExplainOutcome> => {
      capturedEngineFindings = args.engineFindings;
      const first = args.engineFindings[0] as
        | { endpoint?: { key?: string } }
        | undefined;
      const key = first?.endpoint?.key ?? 'unknown-endpoint';
      const payload = serializeExplanation(
        {
          promptVersion: 'v1',
          effectiveModel: 'test-model',
          answer: `${key} is NoKnownImpact.`,
          citations: [],
          conflictingClaims: [],
          budget: { maxToolCalls: 8, toolCallsUsed: 0 },
          toolCallLog: [],
          modelLog: [],
          errors: [],
        } as never,
        { question: args.question, engineFindings: args.engineFindings },
      );
      return { status: 'available', model: 'test-model', payload };
    };

    const worker = new AssessmentWorker(db, {
      getLain: async () => createInstantLain(),
      explain,
    });
    const created = await worker.create(REQUEST);
    const record = await worker.run(created.assessment.id);
    await worker.drain();

    const report = await getAssessmentReport(db, created.assessment.id);
    expect(report).not.toBeNull();
    expect(report!.explanation.status).toBe('available');

    // INV 2: engine_finding_classes copia impact.class verbatim del motor.
    const stored = await db
      .select()
      .from(schema.explanation)
      .where(eq(schema.explanation.assessmentId, created.assessment.id));
    const payload = JSON.parse(stored[0].payload) as {
      engine_finding_classes: Array<{ endpoint: string; class: string }>;
    };
    const engineClasses = capturedEngineFindings.map(
      (f) => (f as { impact?: { class?: string } }).impact?.class,
    );
    expect(payload.engine_finding_classes.map((c) => c.class)).toEqual(engineClasses);
    expect(engineClasses.length).toBeGreaterThan(0);

    // El desacuerdo es visible, no silenciado: se detecta contra el hallazgo
    // real del motor, con la clase que el motor declaró.
    const firstFinding = capturedEngineFindings[0] as {
      endpoint?: { key?: string; service?: string };
      impact?: { class?: string };
    };
    const answer = `${firstFinding.endpoint?.key} is NoKnownImpact.`;
    const conflicts = detectClassificationConflicts(answer, capturedEngineFindings);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]!.claimedClass).not.toBe(conflicts[0]!.engineClass);
    expect(record.status === 'READY' || record.status === 'PARTIAL').toBe(true);
  });
});
```

- [ ] **Step 4: Run the held-out suite (expect green)**

Run: `pnpm test:heldout`
Expected: PASS (3 files). Runtime < 30s.

- [ ] **Step 5: Prove the guard bites (same changeset touching src + held-out)**

On a scratch branch, make a one-line edit to `packages/api/src/coverage.ts` and another to `packages/api/test-heldout/lifecycle-composition.heldout.test.ts`, then:

```bash
git add packages/api/src/coverage.ts packages/api/test-heldout/lifecycle-composition.heldout.test.ts
git commit -m "scratch: same changeset touches src and test-heldout"
GATE_BASE=HEAD~1 pnpm gate:separation    # Expected: "HELDOUT SEPARATION VIOLATION", exit 1
git reset --hard HEAD~1                  # discard the scratch commit
GATE_BASE=HEAD~1 pnpm gate:separation    # Expected: "heldout-separation ok", exit 0
```

- [ ] **Step 6: Commit (red-team style: only test-heldout files)**

```bash
git add packages/api/test-heldout
git commit -m "red-team(test-heldout): add lifecycle, recovery and explanation composition suites"
```

---

### Task 12: StrykerJS setup (api + shared) with incremental baseline

**Files:**
- Modify: `packages/api/package.json` (devDeps `@stryker-mutator/core@10.0.0`, `@stryker-mutator/vitest-runner@10.0.0`)
- Modify: `packages/shared/package.json` (same devDeps)
- Create: `packages/api/stryker.config.json`
- Create: `packages/shared/stryker.config.json`

**Interfaces:**
- Consumes: existing `packages/*/vitest.config.ts`.
- Produces (for Task 13): per-package `reports/mutation/mutation.json` (mutation-testing-report schema: `files: { [path]: { source, mutants: Array<{ id, mutatorName, status, location: { start: { line, column } }, description?, replacement? }> } }`; status one of `Killed | Survived | NoCoverage | CompileError | Timeout | Ignored | Pending`), and `--incremental --incrementalFile` baselines under `packages/*/.stryker-tmp/incremental.json`.

- [ ] **Step 1: Install and write the per-package configs**

```bash
pnpm --filter @parallax/api add -D @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0
pnpm --filter @parallax/shared add -D @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0
```

Create `packages/api/stryker.config.json`:

```json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "vitest": {
    "configFile": "vitest.config.ts",
    "related": true
  },
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "reporters": ["clear-text", "json", "progress"],
  "jsonReporter": { "fileName": "reports/mutation/mutation.json" },
  "coverageAnalysis": "perTest",
  "thresholds": { "high": 90, "low": 75, "break": 0 },
  "concurrency": 2,
  "timeoutMS": 20000,
  "incremental": true,
  "incrementalFile": ".stryker-tmp/incremental.json"
}
```

Create `packages/shared/stryker.config.json` with the same content (its own `vitest.config.ts` reference and `mutate` globs apply from `packages/shared`).

Notes: `thresholds.break: 0` means Stryker itself never fails the run on score — the gate script (Task 13) decides based on survivors, so equivalent mutants can be allowlisted with reasons. `vitest.related: true` narrows tests per mutant, which keeps the DB-backed api suite affordable.

- [ ] **Step 2: Smoke-run Stryker on one file (verify the toolchain)**

Run: `pnpm --filter @parallax/shared exec stryker run --mutate src/lain/evidence.ts`
Expected: run completes; the clear-text table shows mutants with status `Killed` and possibly `Survived` for `paginate`; `packages/shared/reports/mutation/mutation.json` exists and contains a `files` map with `src/lain/evidence.ts`.

- [ ] **Step 3: Verify the report shape the gate will parse, then commit**

Run: `node -e "const r=require('./packages/shared/reports/mutation/mutation.json'); const f=r.files['src/lain/evidence.ts']; console.log(f.mutants.map(m=>m.mutatorName+':'+m.status+':'+m.location.start.line).join('\n'))"`
Expected: one line per mutant (`BlockStatement:Killed:33`, …) — proves `files[path].mutants[].{mutatorName,status,location.start.line}`.

Add `packages/*/reports/` and `packages/*/.stryker-tmp/` to `.gitignore`. Commit:

```bash
git add packages/api/package.json packages/shared/package.json packages/api/stryker.config.json packages/shared/stryker.config.json .gitignore pnpm-lock.yaml
git commit -m "test: add stryker mutation testing configs"
```

---

### Task 13: Incremental mutation gate over the PR diff (TDD)

**Files:**
- Create: `packages/gates/src/mutation-gate.ts`
- Create: `packages/gates/src/cli/mutation-gate.ts`
- Create: `packages/gates/test/mutation-gate.test.ts`
- Create: `mutation-allowlist.json` (root)
- Modify: `.github/workflows/ci.yml` (job `mutation`)

**Interfaces:**
- Consumes: Stryker JSON report shape (Task 12), `git diff --name-only <base>...HEAD`.
- Produces: `parseMutationReport(report: unknown): MutantSummary[]` with `MutantSummary = { file: string; mutator: string; line: number; status: string; description: string }`; `gateDecision(mutants: readonly MutantSummary[], allowlist: readonly AllowlistEntry[], pkg: string): { blocked: MutantSummary[]; allowlisted: MutantSummary[] }` with `AllowlistEntry = { package: string; file: string; mutator: string; line: number; reason: string }`; `validateAllowlist(entries: readonly AllowlistEntry[]): string[]` (non-empty problems list). CLI `pnpm --filter @parallax/gates run gate:mutation` exits 1 when `blocked` is non-empty.

- [ ] **Step 1: Write the failing tests**

Create `packages/gates/test/mutation-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  gateDecision,
  parseMutationReport,
  validateAllowlist,
  type AllowlistEntry,
} from '../src/mutation-gate.js';

const REPORT = {
  files: {
    'src/coverage.ts': {
      source: 'x',
      mutants: [
        {
          id: '1',
          mutatorName: 'BlockStatement',
          status: 'Survived',
          location: { start: { line: 68, column: 1 }, end: { line: 68, column: 5 } },
          description: 'block statement was removed',
        },
        {
          id: '2',
          mutatorName: 'EqualityOperator',
          status: 'Killed',
          location: { start: { line: 88, column: 3 }, end: { line: 88, column: 9 } },
        },
      ],
    },
  },
};

describe('parseMutationReport', () => {
  it('flattens the mutation-testing-report schema into summaries', () => {
    const mutants = parseMutationReport(REPORT);
    expect(mutants).toHaveLength(2);
    expect(mutants[0]).toEqual({
      file: 'src/coverage.ts',
      mutator: 'BlockStatement',
      line: 68,
      status: 'Survived',
      description: 'block statement was removed',
    });
  });

  it('returns an empty list for an empty or malformed report', () => {
    expect(parseMutationReport({})).toEqual([]);
    expect(parseMutationReport(null)).toEqual([]);
  });
});

describe('gateDecision', () => {
  const allowlist: AllowlistEntry[] = [
    {
      package: '@parallax/api',
      file: 'src/coverage.ts',
      mutator: 'BlockStatement',
      line: 68,
      reason: 'equivalent: filter redundancy covered by Task 4 property',
    },
  ];

  it('blocks Survived and NoCoverage mutants outside the allowlist', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, [], '@parallax/api');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
    expect(decision.allowlisted).toEqual([]);
  });

  it('moves allowlisted survivors out of the blocked set', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, allowlist, '@parallax/api');
    expect(decision.blocked).toEqual([]);
    expect(decision.allowlisted.map((m) => m.line)).toEqual([68]);
  });

  it('does not apply an allowlist entry to another package', () => {
    const mutants = parseMutationReport(REPORT);
    const decision = gateDecision(mutants, allowlist, '@parallax/shared');
    expect(decision.blocked.map((m) => m.line)).toEqual([68]);
  });

  it('ignores Killed mutants entirely', () => {
    const mutants = parseMutationReport(REPORT).filter((m) => m.status === 'Killed');
    expect(gateDecision(mutants, [], '@parallax/api').blocked).toEqual([]);
  });
});

describe('validateAllowlist', () => {
  it('rejects entries without a reason', () => {
    const problems = validateAllowlist([
      { package: '@parallax/api', file: 'src/a.ts', mutator: 'X', line: 1, reason: '' },
      { package: '@parallax/api', file: 'src/a.ts', mutator: 'X', line: 2, reason: '   ' },
    ]);
    expect(problems).toHaveLength(2);
  });

  it('accepts fully specified entries', () => {
    expect(validateAllowlist([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @parallax/gates run test`
Expected: FAIL (`Cannot find module '../src/mutation-gate.js'`).

- [ ] **Step 3: Implement (green)**

Create `packages/gates/src/mutation-gate.ts`:

```ts
export interface MutantSummary {
  file: string;
  mutator: string;
  line: number;
  status: string;
  description: string;
}

export interface AllowlistEntry {
  package: string;
  file: string;
  mutator: string;
  line: number;
  reason: string;
}

interface RawMutant {
  mutatorName?: string;
  status?: string;
  description?: string;
  location?: { start?: { line?: number } };
}

interface RawReport {
  files?: Record<string, { mutants?: RawMutant[] }>;
}

/** Aplana el reporte JSON de Stryker (schema mutation-testing-report). */
export function parseMutationReport(report: unknown): MutantSummary[] {
  const root = (report ?? {}) as RawReport;
  const out: MutantSummary[] = [];
  for (const [file, entry] of Object.entries(root.files ?? {})) {
    for (const m of entry.mutants ?? []) {
      out.push({
        file,
        mutator: m.mutatorName ?? '',
        line: m.location?.start?.line ?? 0,
        status: m.status ?? 'Unknown',
        description: m.description ?? '',
      });
    }
  }
  return out;
}

/** Survived/NoCoverage bloquean salvo que estén en el allowlist del paquete. */
export function gateDecision(
  mutants: readonly MutantSummary[],
  allowlist: readonly AllowlistEntry[],
  pkg: string,
): { blocked: MutantSummary[]; allowlisted: MutantSummary[] } {
  const isAllowed = (m: MutantSummary): boolean =>
    allowlist.some(
      (e) => e.package === pkg && e.file === m.file && e.mutator === m.mutator && e.line === m.line,
    );
  const survivors = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
  return {
    blocked: survivors.filter((m) => !isAllowed(m)),
    allowlisted: survivors.filter(isAllowed),
  };
}

/** Un allowlist sin justificación es una puerta falsa: se rechaza. */
export function validateAllowlist(entries: readonly AllowlistEntry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    if (!e.reason || e.reason.trim().length === 0) {
      problems.push(`allowlist entry without reason: ${e.package} ${e.file}:${e.line} ${e.mutator}`);
    }
  }
  return problems;
}
```

Create `packages/gates/src/cli/mutation-gate.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  gateDecision,
  parseMutationReport,
  validateAllowlist,
  type AllowlistEntry,
} from '../mutation-gate.js';

const base = process.env.GATE_BASE ?? 'origin/main';
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function changedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

const allowlistPath = join(repoRoot, 'mutation-allowlist.json');
const allowlist: AllowlistEntry[] = existsSync(allowlistPath)
  ? (JSON.parse(readFileSync(allowlistPath, 'utf8')) as { entries: AllowlistEntry[] }).entries
  : [];
const problems = validateAllowlist(allowlist);
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

// Archivos mutados: sólo los src/*.ts tocados por el diff, agrupados por paquete.
const changedSrc = changedFiles().filter((f) => /^packages\/[^/]+\/src\/.*\.ts$/.test(f));
const byPackage = new Map<string, string[]>();
for (const f of changedSrc) {
  const pkg = f.split('/')[1]!;
  const rel = f.slice(`packages/${pkg}/`.length);
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg)!.push(rel);
}

if (byPackage.size === 0) {
  console.log('mutation-gate: no changed src files — nothing to mutate');
  process.exit(0);
}

let failed = false;
for (const [pkg, files] of byPackage) {
  const args = ['exec', 'stryker', 'run', '--incremental', '--incrementalFile', '.stryker-tmp/incremental.json'];
  for (const f of files) args.push('--mutate', f);
  execFileSync('pnpm', ['--filter', `@parallax/${pkg}`, ...args], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  const reportPath = join(repoRoot, 'packages', pkg, 'reports/mutation/mutation.json');
  const mutants = parseMutationReport(JSON.parse(readFileSync(reportPath, 'utf8')));
  const relevant = mutants.filter((m) => files.includes(m.file));
  const decision = gateDecision(relevant, allowlist, `@parallax/${pkg}`);
  console.log(
    `mutation-gate ${pkg}: ${relevant.length} mutants, ${decision.allowlisted.length} allowlisted, ${decision.blocked.length} blocked`,
  );
  for (const m of decision.allowlisted) {
    console.log(`  allowlisted ${m.file}:${m.line} ${m.mutator} (${m.status})`);
  }
  for (const m of decision.blocked) {
    console.error(`  BLOCKED ${m.file}:${m.line} ${m.mutator} (${m.status}) ${m.description}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
```

Create `mutation-allowlist.json` (root):

```json
{
  "entries": []
}
```

- [ ] **Step 4: Run the unit tests (expect green)**

Run: `pnpm --filter @parallax/gates run test`
Expected: PASS (8 tests).

- [ ] **Step 5: End-to-end check of the gate on a real diff, then wire CI**

```bash
pnpm gate:mutation   # with no src changes: "no changed src files — nothing to mutate", exit 0
```

Then make a deliberate weak change to prove the gate blocks: in `packages/api/src/coverage.ts`, replace `const complete = (lain.complete ?? false) && unreviewed.length === 0;` with `const complete = true;` (without touching any test), commit on a scratch branch, run `GATE_BASE=HEAD~1 pnpm gate:mutation` — Expected: Stryker kills or spares mutants; if any mutant in the touched file survives, the gate prints `BLOCKED …` and exits 1. Revert the scratch commit. (If the surviving-mutant set is empty because all mutants died, the gate correctly exits 0 — record that in the commit message; the blocking path is covered by unit tests.)

Modify `.github/workflows/ci.yml`: add job `mutation`:

```yaml
  mutation:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 12.11.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24.21.0
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Restore stryker incremental baseline
        uses: actions/cache@v4
        with:
          path: packages/*/.stryker-tmp
          key: stryker-${{ runner.os }}-${{ github.base_ref }}-${{ github.sha }}
          restore-keys: |
            stryker-${{ runner.os }}-${{ github.base_ref }}-
      - name: Mutation gate on changed files
        run: pnpm --filter @parallax/gates run gate:mutation
        env:
          GATE_BASE: origin/${{ github.base_ref }}
```

- [ ] **Step 6: Commit**

```bash
git add packages/gates/src/mutation-gate.ts packages/gates/src/cli/mutation-gate.ts packages/gates/test/mutation-gate.test.ts mutation-allowlist.json .github/workflows/ci.yml
git commit -m "feat(gates): add incremental mutation gate on the PR diff"
```

---

### Task 14: Red-team protocol + dispatch prompt template

**Files:**
- Create: `docs/testing/red-team-protocol.md`
- Create: `docs/testing/red-team-prompt.md`
- Modify: `README.md` (one paragraph under "Project structure" pointing at the protocol)

**Interfaces:**
- Consumes: `pnpm test:heldout`, `pnpm gate:separation`, `pnpm gate:mutation`, `mutation-allowlist.json` (Tasks 9–13).
- Produces: the operational contract for the adversarial agent role (context boundary, ownership rules, workflow loop) and the verbatim dispatch prompt template.

- [ ] **Step 1: Write the protocol**

Create `docs/testing/red-team-protocol.md`:

```markdown
# Red-team protocol (adversarial test agent)

## Roles

- **Implementer** (coding agent): owns `packages/*/src/**` and `packages/*/test/**`
  (the visible suite `T_val`, including `test/prop/`). Never reads or edits
  `packages/*/test-heldout/**`.
- **Red team** (adversarial agent): owns `packages/*/test-heldout/**` and
  `docs/testing/**`. Never edits implementation files. Its entire context is the
  spec (design doc + public interface signatures) and the current failure
  signals (mutation report, held-out failures).

## Why

If the only feedback an agent gets is "the visible suite is green", the cheapest
path is hardcoding and feature isolation: happy paths, branches tuned to known
cases, components that pass alone and break when composed. The held-out suite
(`test-heldout/`, run only by `pnpm test:heldout` in CI) and the mutation gate
(`pnpm gate:mutation`, only over the PR diff) close both escape routes.

## Ownership enforcement

`pnpm gate:separation` (CI job `separation-guard`) fails any changeset that
touches both implementation and `test-heldout/`. Held-out changes travel in
`red-team:`-prefixed changesets that touch no implementation files.

## Workflow loop

1. Run `pnpm gate:mutation` on the branch (or read the CI job output). Collect
   the `BLOCKED` survivors.
2. Dispatch the red team with `docs/testing/red-team-prompt.md`, handing it:
   the use-case spec excerpt, the public signatures under test, and the survivor
   list (file:line, mutator, description).
3. The red team writes new tests in `test-heldout/` designed to kill the
   survivors and to compose features end-to-end (one scenario per composed flow),
   never asserting implementation details (never the exact terminal status the
   worker picks, never internal call counts).
4. Verify: `pnpm test:heldout` red on the pre-fix code (the tests must fail
   against the mutant or the weak implementation), green after the fix.
   Every equivalent mutant that legitimately survives goes to
   `mutation-allowlist.json` with a `reason`.
5. Implementer fixes the code; the separation guard keeps the oracle untouched.

## What the red team must attack

- Composition: flows that cross worker + services + MCP/HTTP + preview, not
  units in isolation.
- Edges: empty manifests, empty repo maps, unicode names, exclusion overlap.
- The duplicated definitions (`AssessmentStatus` in shared and api) and other
  feature-isolation seams.
```

- [ ] **Step 2: Write the dispatch prompt template**

Create `docs/testing/red-team-prompt.md`:

```markdown
# Red-team dispatch prompt (verbatim template)

You are the adversarial test agent (red team) for this repository. Your job is
to REFUTE the implementation, not to praise it.

Context you receive (and nothing else):
1. The use-case specification excerpt for the feature under test.
2. The public interface signatures (exports and types) — NOT the source code.
3. The current failure signals: surviving mutants from
   `pnpm gate:mutation` (file:line, mutator, description) and/or failing
   scenarios in `pnpm test:heldout`.

Hard rules:
- You may create or edit ONLY files under `packages/*/test-heldout/`.
- Never edit `packages/*/src/**`, `packages/*/test/**`, or CI config.
- Never assert implementation details: no exact terminal status choices, no
  internal method call counts, no private field state. Assert the spec's
  invariants and cross-module consistency only.
- Every test must fail against the listed mutant (or the weak behavior under
  suspicion). If you cannot make it fail, do not add it.

Deliverables:
- One `*.heldout.test.ts` file per composed scenario, named for the scenario
  (e.g. `lifecycle-composition.heldout.test.ts`).
- For each surviving mutant: the specific test that kills it, or — if the
  mutant is provably equivalent — a proposed `mutation-allowlist.json` entry
  with a one-line `reason` (you propose; a human approves).
- A short report: what you attacked, what died, what survived and why.

Verify before reporting: `pnpm test:heldout` passes on your tests after the
implementer's fix is applied, and each new test fails when the fix is reverted
(show the command and its output for at least one case).
```

- [ ] **Step 3: Link the protocol from the README and validate the docs**

In `README.md`, under "Project structure", add:

```markdown
Testing follows an anti-reward-hacking protocol: property-based and model-based
tests (`test/prop/`), a held-out composition suite (`test-heldout/`) owned by a
red-team agent, and a mutation gate over each PR diff. See
`docs/testing/red-team-protocol.md`.
```

Validate the template contains no implementation paths (the red team's context boundary):

```bash
grep -c "src/" docs/testing/red-team-prompt.md
```
Expected: `1` (only the `Never edit packages/*/src/**` rule) — if more, remove leaked paths.

Run: `pnpm lint && pnpm format:check` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/testing README.md
git commit -m "docs: add red-team protocol and dispatch prompt template"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-15-anti-reward-hacking-test-stack.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**, because the 14 tasks form a chain of shared interfaces (arbitraries → property suites → worker harness → held-out → gates) where a small mistake in an early helper silently weakens every later property — exactly the failure mode this stack exists to catch, and a fresh reviewer per task is the cheapest insurance. Does the plan capture what you want, and which approach should we use?
