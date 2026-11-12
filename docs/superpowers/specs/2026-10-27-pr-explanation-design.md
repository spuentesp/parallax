# PR Explanation — Findings in, Explanation by Id, Facts Composed by the Backend

**Date:** 2026-10-27
**Status:** Implemented (`863835e` and follow-up). Open items at the end.
**Scope:** `packages/api` (`agent/pr-explain.ts`, `agent/investigator.ts`, `worker/assessment-worker.ts`, `plugins/assessment-worker.ts`, `services/assessments.ts`), `packages/shared` (report schema), `packages/web` (assessment page).

## Problem

The assessment pipeline analyzes a PR deterministically (`diff_contracts`, `get_coverage`, `trace_impact`) and persists the result as `engine_json`. The explain step then asked the open-ended Q&A investigator to "explain these contract changes" **without passing them**. The engine findings were used only after the fact, to detect class conflicts. The model rediscovered the diff through tools, or invented it.

Measured on a fixture with a known diff (5 engine findings, Nemotron Super, 3 runs): 6 of 15 findings were even mentioned, and 0 of 3 runs passed. Lightning mentioned 12 of 15 but spent about 15 tool calls rediscovering the diff and promoted engine classes in every run.

Two bugs in the analyze step made the coverage worse, and flowed straight into the explanation:

1. `trace_impact` ran in the **head** snapshot for every finding. A removed endpoint does not exist in head (`contract_not_found`), so the consumers of the most serious findings were lost and reported as a coverage gap.
2. Engine errors are plain objects, not `Error`; coverage gaps read `[object Object]`.

## Design

**The engine decides facts and classes. The model explains.**

- **Input.** In PR mode the investigator receives the findings as `F1…Fn`: kind, endpoint, compatibility, the engine class **verbatim**, its reasons, the affected consumers, and the evidence ids the engine delivered with the finding. It also receives the coverage line. It has its own system prompt, a research budget of 6 (drill-down only), and the same read tools.
- **Output.** The model ends with `submit_answer` carrying a `summary` and one explanation per finding id (plus optional evidence ids).
- **Composition.** The backend writes everything that is fact: for each finding, its kind, endpoint, engine class and affected services; the coverage line and its reason; and `NOT EXPLAINED by the model.` for any finding the model skipped. The model's text fills only the summary and the per-finding explanation.
- **Verification is by id, not by searching prose.** Unexplained findings are listed (`unaddressed`); ids the engine never reported are recorded (`unknownIds`) and dropped from the narrative; class promotion in the model's text is still detected (P INV 2); evidence ids are validated as before (P INV 1).
- **Fallback.** If the model answers in prose instead, it is judged as before (no per-finding verification).

### Status semantics (a change)

In PR mode, `explanationStatus` is:

| Status | Meaning |
|---|---|
| `available` | Every finding has an explanation. A resolved citation is **not** required. |
| `failed:findings_unaddressed` | At least one finding has no explanation. The narrative, the explanations given and the gap are kept and shown. |

`available` therefore no longer implies "at least one citation resolved" for PR explanations. The reason: the findings are engine facts and are already in the narrative with the engine's own evidence; requiring the model to add a citation would make a correct explanation fail for style. Invented or unresolvable citations are still **listed as rejected** (`citations.rejected`, per-finding `evidence.rejected`); they do not change the status. For Q&A, `available` keeps its meaning (a prose anchor resolved, or an engine-verified claim, or a supported note).

### Views

A PR analysis spans two snapshots, and each kind of fact lives in a different one:

| Fact | View |
|---|---|
| Impact of a **removed** endpoint (who consumed it) | base |
| Impact of an added or changed endpoint | head |
| Consumer-side findings | paths come with the diff; not traced separately |
| Evidence ids delivered with a finding | head, then base if it does not resolve in head |

The last row matters: on the engine fixture, the provider route node of a removed endpoint resolves in base and **not** in head (`exists: false`), so a model that cited exactly what the engine gave it would have been rejected as `unresolvable_in_view` and looked like it fabricated a citation. The mock engine answers `exists: true` to everything, which is why unit tests alone could not see it.

The model's drill-down tools (`read_source` etc.) still read the head view only. Reading the removed code at base through the tools is not supported.

### What users see

The persisted explanation payload now reaches users. The served report carries `explanation.narrative` and `explanation.unaddressed`; the PR comment preview and the web assessment page render the narrative next to the status. Before this change they showed only status, model and revision.

## Evaluation

`scripts/pr-fixture.ts` builds two git repos with real history (a consumed endpoint removed, an unconsumed one removed, one added, one unchanged) and starts Lain on them; `scripts/eval-pr.ts` runs the full flow per run on a fresh database and scores against `engine_json` (`scripts/eval-pr-score.ts`, mechanical, with its own tests).

Results (Saleor-independent fixture, 3 runs per model):

| | Super | Lightning |
|---|---|---|
| Before | 0/3, 6 of 15 findings mentioned | 0/3, 12 of 15, about 15 tool calls |
| After | 3/3, 15/15 explained, no reads | 1–2/3, 15/15 explained, 8–13 tool calls, class promotion flagged in 1–2 runs |

**Read these numbers with care.** The two columns are not measured the same way: the scorer changed between them (before: engine keys searched in the model's prose; after: the per-finding explanation record, because the composed narrative now names every finding by construction), and the trace fix landed in between. "Explained" being 15/15 is largely a property of the structure; what the scorer still tests about the model is invented routes, class promotion, and status. Super's "tools=1" is the `submit_answer` call itself: it made no reads. Judge explanation quality by reading the text (`PR_EVAL_PRINT=1`): in the runs read, Super kept every engine class, said why a `NeedsInvestigation` stays one, and stated the coverage gap.

## Open items

- The fixture has one consumer and one provider; it exercises the structure, not breadth. A fixture with several consumers per endpoint and a field-level change would test more.
- `read_source` / `get_service` at the base view for removed code.
- Claims verification (`docs/superpowers/specs/2026-10-26-verifiable-claims-design.md`) is not applied in PR mode: a relation claim checked at head would call a removed dependency "contradicted" although it was true at base. It needs a base/head view on claims first.
- The comment preview includes the model's narrative verbatim. Whether it should be posted to the PR (as opposed to the commit status) is the open decision in the PR evaluation design.
