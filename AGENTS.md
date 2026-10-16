# AGENTS.md — rules binding for coding agents in parallax

## Anti reward-hacking rules

1. **Write-Then-Read**: in `test-heldout/` (and any DST/composition test), the
   state under test must come from the real write path. Never hand-insert into
   `assessment`/`evidence`/`explanation`/`jobStep`/`event` to fabricate a state
   a reader then consumes. Enforced by `packages/gates/test/repo-policy.test.ts`.
2. **Mock only at the process edge**: never `vi.mock` internal modules of this
   repo (hooks, stores, services) in tests; intercept the network boundary or
   inject a transport. Internal mocks are how feature isolation hides.
3. **No-op bypasses are failures**: every pipeline stage a feature claims to run
   must be observable in a test (see the jobStep assertions in
   `test-heldout/lifecycle-composition.heldout.test.ts`). An early `return` or a
   swallowed error that turns tests green is reward hacking.
4. **Held-out suite is not editable by implementers**: see
   `docs/testing/red-team-protocol.md`; the separation guard blocks mixed
   changesets in CI.
