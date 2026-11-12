# Verifiable Claims — Absence, Presence, and Contradiction in Investigator Answers

**Date:** 2026-10-26
**Status:** Approved direction (B, terminate with a tool, prose fallback, contradictions are flagged and do not fail the answer). Phase 1 implemented (receipts, `submit_answer`, relation and note claims, engine verification). Phase 2 (operation claims, relevance of anchors) is open.
**Scope:** `packages/api/src/agent` (investigator, dispatcher, validator), `ExplanationPayload`, the Saleor eval. No change to Lain.

## Problem

The investigator's guarantee today (P INV 1) is: every citation must be an evidence id the backend delivered, and at least one must resolve. That guarantees an answer *touches* real code. It does not guarantee the answer is *about* that code, and it has no way to express a claim that has no code behind it.

Observed on the Saleor workspace (Lain 0.12.1, `eval-saleor.ts`, question "Does saleor-api consume saleor-dashboard or saleor-storefront?", Nemotron Super):

1. **Fabricated id.** The model gave a correct answer ("no") and cited `[ev:saleor-dashboard:consumers_of:[]]`. No such id was delivered; the whole answer failed as `citations_unresolved`.
2. **Borrowed anchor.** On another run the same correct answer cited `[ev:storefront:Function:src/checkout/graphql/user.graphql:graphql-call%3Aquery%3Ame:21]` for "the consumers_of result for saleor-dashboard was empty". That id was delivered, so the answer passed as `available`. The citation proves nothing about the claim.
3. **Unchecked contradiction.** An earlier run answered that the storefront "does not call the Saleor API directly", while the engine records `saleor-storefront` as a consumer of `saleor-api` (`gate:saleor` verifies it). The answer had valid citations and passed.

All three have one cause: **an answer is prose, and the backend can only check the ids inside it, not what the prose asserts.** Case 1 punishes a correct absence claim; case 2 quietly weakens INV 1; case 3 is the gap noted in the architecture review (validation checks citations, not truth).

## What an absence claim is

"X has no consumers" is true when a query over a reviewed scope returned zero rows and the result was complete. The evidence is not a code location; it is the **query and its completeness**. The engine already says how complete a result is: `scope.reviewed` / `scope.unreviewed`, `provider_reviewed`, and our own `cut` declaration for truncated results.

An absence claim over an *incomplete* result is not evidence of absence. That is P INV 3 (omissions are never hidden) applied to claims.

## Goals

1. A correct absence claim can be supported, and an unsupported one cannot pass.
2. A citation must be relevant to the claim it supports, as far as the backend can check.
3. Claims about relations between services are checked against the engine, not against the model's own prose.
4. The model never decides a fact. The engine does (P INV 2 is unchanged).

## Options

### A. Query receipts only

Every successful tool call gets a backend-minted receipt id (`q:3`) recording tool, normalized arguments, row count, and `complete` (no truncation, no omitted endpoints for the filter, no unreviewed repos in scope). The model may cite `[ev:q:3]`. The validator accepts a receipt only if it exists in this investigation, and accepts it for an *absence* only if `complete`.

- Fixes case 1. Does not fix case 2 (a borrowed code anchor still passes) or case 3.
- Small: a map in the dispatcher and a branch in `validateCitations`.
- The validator cannot tell from prose whether a given sentence is an absence claim, so "receipt must be complete" can only be enforced on the receipt the model chose to cite, not on the claim it supports.

### B. Structured submission with typed claims (recommended)

The model ends by calling a `submit_answer` tool instead of writing free text:

```json
{
  "answer": "markdown explanation for humans",
  "claims": [
    { "kind": "relation", "consumer": "saleor-storefront", "provider": "saleor-api",
      "polarity": "present", "evidence": ["saleor-storefront:Function:…:graphql-call%3Aquery%3Aproduct:12"] },
    { "kind": "relation", "consumer": "saleor-api", "provider": "saleor-dashboard",
      "polarity": "absent", "evidence": ["q:4"] },
    { "kind": "note", "text": "…", "evidence": ["…"] }
  ]
}
```

The backend verifies each claim itself:

| Claim | Check | Verdict |
|---|---|---|
| `relation` present | engine has the edge (from `get_service` consumers, already harvested into `consumedEdges`) | `verified` / `contradicted` |
| `relation` absent | engine has no such edge **and** a cited receipt for that provider is `complete` | `verified` / `contradicted` / `unverifiable` (incomplete) |
| `operation` (consumer uses endpoint key) | the key exists in that consumer's uses for that provider | `verified` / `contradicted` |
| `note` | evidence ids delivered and resolvable (today's INV 1 check) | `supported` / `unsupported` |

- `contradicted` means the engine disagrees with the model. That is case 3, detected deterministically.
- A claim's evidence must be relevant: for a `relation` or `operation`, at least one cited anchor must belong to the claimed consumer's repo, or to a receipt for the claimed provider. That closes case 2 for structured claims.
- The prose `answer` stays for humans; its `[ev:]` markers are still extracted and validated as today. Structured claims are additive.

Cost: a larger change to the loop (a terminating tool, a fallback when the model answers in prose), and claim schemas to maintain. Lightning may not produce them reliably; that is acceptable, since it is not the recommended worker.

### C. A second model as claim checker

Ask a model to judge whether the answer's citations support its claims. Rejected: it puts a model in the verification path, violates "the engine decides", and cannot be audited the way an edge lookup can.

## Recommendation

Do **B**, in two phases, and fold A into it (receipts are the evidence form for absences).

**Phase 1: receipts and relation claims**
1. Dispatcher mints receipts (`q:N`) with `complete`, and returns the id in each tool result so the model can cite it.
2. `submit_answer` tool with `relation` and `note` claims. If the model answers in prose instead, nothing changes from today (claims = `[]`, status as now).
3. Claim verification against `consumedEdges` / `get_service` data, with the verdicts above.
4. `ExplanationPayload.claims` stores each claim with its verdict and evidence; the UI can show them.

**Phase 2: operation claims and relevance**
5. `operation` claims; relevance check on anchors (an anchor cited for a relation must belong to the consumer's repo, or to a receipt for the provider).
6. Eval: per-claim verdict counts, and cases that exercise absence and contradiction.

## Behaviour changes

- An absence over an incomplete result is `unverifiable`, not accepted. In Saleor today `scope.unreviewed` is empty, so absence claims there verify; in a partially indexed workspace they will not, which is the point.
- **A contradicted claim does not change `explanationStatus`.** The answer stays as the model wrote it; the claim carries `verdict: contradicted` with the engine's side (what the engine has instead), the response carries `claims_summary.contradicted`, and the UI points at it. The model's prose is never edited (P INV 2).
- `available` is unchanged in meaning for prose answers (at least one anchor resolved). For structured answers it also holds when at least one claim was verified by the engine, so a correct absence no longer needs an anchor.
- Self-consumption (`saleor-api` consuming itself through a table read) is a real engine edge. Relation claims about it verify as `present`; the prompt should not hide it.
- The verifier reads the engine itself (`get_service` on the provider); it does not rely on what the model happened to query, and its reads do not use the model's tool budget.

## Evaluation

`eval-saleor.ts` gains claim-level metrics: verified, contradicted, unverifiable, unsupported per run. The pass rule for yes/no cases becomes "the structured claim has the right polarity and verdict `verified`", replacing first-sentence text matching. The three cases above become regression cases.

## Open decisions

1. ~~Terminate with a tool vs. prose.~~ Decided: `submit_answer` tool, with prose fallback.
2. ~~Should `contradicted` fail the whole answer?~~ Decided: no. It marks the claim and is surfaced; the status is unchanged.
3. **Claim kinds in phase 1.** `relation` and `note` only, or include `operation` from the start? Recommended: `relation` and `note`; `operation` after the eval shows how often it is needed.
4. **Where claims are stored.** Inside the existing explanation payload (no migration) vs. a `claim` table (queryable, needs a migration). Recommended: payload first.

## Non-goals

- Verifying claims the engine cannot adjudicate (design rationale, intent, "why"). Those stay `note` claims backed by anchors.
- Changing any Lain behaviour or the engine's classifications.
- Scoring answer prose quality.

## Phase 1 results (Saleor, Lain 0.12.1, Nemotron Super, 20 runs per batch)

- Nemotron Super, 20 runs per batch: 15/20 without structured claims, then 16/20 and 16/20 with them. The gain is within run-to-run noise; what changed is what an answer can express.
- "Does saleor-api consume X" was 3/5 without claims, 5/5 in the first structured batch (a correct absence no longer needs an anchor) and 3/5 in the second; at 5 runs per case the case-level numbers are noisy.
- Lightning swung between 4/20 and 12/20 across batches and is not a usable worker here.
- Only about half of Super's answers use `submit_answer` (11 to 15 of 20); the rest fall back to prose and are not claim-checked.
- The eval produced no contradicted claims. On a leading false premise ("explain how saleor-api calls saleor-storefront"), the model inverted the direction of a real storefront → saleor-api dependency; the engine marked the relation claim `contradicted` and returned its own side. Five note claims repeating the same inverted statement were marked `supported`, because their anchors resolve: this is the relevance gap that phase 2 targets.
