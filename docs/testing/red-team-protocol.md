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
- Generator discipline: any property pairing two random structures needs a
  correlated generator (see the lessons in `docs/superpowers/plans/2026-10-15-anti-reward-hacking-test-stack.md`
  — uncorrelated generators made two teeth checks pass vacuously).
