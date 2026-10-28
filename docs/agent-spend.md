# Agent spend and convergence: measurements

Date: 2026-10-28. Model: Nemotron on Nebius Token Factory (Super 120B planner, Lightning worker), Saleor workspace (3 repos), Lain 0.13.0. Every number below is from a real run, not an estimate.

## The problem

The investigator answered by calling Lain tools in a loop. Nothing bounded it: the same search could be repeated with new words, results of up to 24 KB were re-sent to the model on every later round, and a question could end with the budget spent and no usable answer.

**Baseline, 4 questions, model default (thinking on):**

| Question | Time | Rounds | Tool calls | Input tokens | Result |
|---|---|---|---|---|---|
| Where is the shipping address set? | 56 s | 18 | 19 (11 × `search_code`) | 290k | **failed** (0/4 claims supported) |
| Who consumes saleor-api? | 41 s | 1 | 2 | 15k | 3/3 verified |
| Add a delivery note to checkout: where? | 48 s | 19 | 20 (16 × `search_code`) | **502k** | answered, unverifiable claims |
| "Tell me about this system" | 28 s | 3 | 2 | 61k | answered |
| **Total** | | | **43** | **868k** | |

Output tokens were small (1.5–5k per question). **The cost is input**: every round resends the whole conversation, so wandering rounds × context is what burns tokens.

## Does turning the model's thinking off help?

Measured, because it was the obvious guess:

| | Classifier (5 cases) | Investigator, onboarding question | Investigator, vague question |
|---|---|---|---|
| Thinking on | 13.1 s, 3,277 tokens | 48 s, 502k in | 28 s, 61k in |
| Thinking off (`chat_template_kwargs.enable_thinking=false`) | **2.0 s, 253 tokens** | 57 s, **790k** in | 70 s, 409k in |

- For **short structured replies** (the loose-ends classifier) it is a large win: ~13× fewer tokens and ~6× faster, with the same number of verdicts parsed. Quality needed the stronger model: Lightning with thinking off produced unusable replies for 5 of 12 cases; Super with thinking off answered all 12 (7/7 agreement with the thinking-on reference).
- For the **tool-calling loop** it made the model wander more (more rounds, more calls). So the investigator keeps the server default (`INVESTIGATOR_THINKING` unset). The classifier always runs with thinking off.

## What was changed

1. **Duplicate refusal and per-tool caps** (dispatcher). An identical call is refused without touching the engine; `search_code` is capped at 4, other tools at 3–6. A refusal says what to do instead.
2. **Forced delivery** (loop). At 60% of the tool budget the model is asked once to wrap up; on the last read, or when 30% of the time is left, or when rounds reach the tool budget (refused calls cost rounds, not reads), the next call is forced to be `submit_answer`.
3. **Default budget** 16 → 10 tool calls; result cap 24 KB → 10 KB (declared cuts, as before).
4. **Token accounting**: `budget.promptTokens`, `completionTokens` and `rounds` in every `/api/query` response.
5. **Classifier budget**: ≤ 20 model calls and ≤ 120 s per run, usage reported in the run status; failed or unusable verdicts are never cached.
6. **Location claims** (below).

**After, same 4 questions, model default:**

| Question | Time | Rounds | Tool calls | Input tokens | Result |
|---|---|---|---|---|---|
| Shipping address | 28–61 s | 6–7 | 7 | 91–113k | answered; **3/3 verified**, incl. a code location |
| Who consumes saleor-api | 12–50 s | 1–3 | 2–4 | 15–36k | answered |
| Delivery note | 16–52 s | 7–9 | 8–10 | 71–120k | answered; **4/4 verified** (all locations) |
| Vague | 47 s | 6 | 6 | 92k | answered |
| **Total (first guarded run)** | | | **23** | **267k** | |

Input tokens **868k → 267k (−69%)**, tool calls **43 → 23**, and the worst case went from failed to answered. Run-to-run variance is real (the same question took 28 s and 61 s), so read these as ranges.

## Why the onboarding answer used to fail verification

Code questions are answered from `search_code` results, which give `file:line`, not the evidence ids the verifier accepted. A correct answer showed up as "unsupported". A new claim kind fixes that:

`location`: `repo`, `path`, `line` and `contains` (the exact symbol or text that must appear within ±5 lines). The engine reads the lines back with `get_code_snippet`: **verified** if the text is there, **contradicted** if the file/line does not exist or the text is not there, **unverifiable** if the repo is outside the analysed view or the engine fails. An answer that states `path:line` without any location claim is sent back once.

Example (real): `saleor:saleor/checkout/utils.py:440` with `contains: "change_shipping_address_in_checkout"` → verified.

The chat summary no longer prints misleading zeros ("0 verified" next to 4 *supported* claims): it lists the verdicts that exist and says what each means (`supported` = backed by evidence the engine delivered, not independently checked).

## Loose-ends classifier, measured

40 loose ends in Saleor: 13 classified by path rules and 14 by the engine's own reason (`dynamic_topic`) with **no model**; the rest are judged by Nemotron in batches of 5.

| | Calls | Completion tokens | Time |
|---|---|---|---|
| First version (thinking on, batch of 10) | 2 + retries | 16k+ (replies cut off) | 227 s, 5 cases left unanswered |
| Final (rules first, Super, thinking off, batch of 5) | 4 | ~2.7k | ~21 s |

## Still open

- Variance: the model sometimes submits `note` claims where `relation` or `location` claims would be verifiable; the loop nudges once, it does not loop.
- `INVESTIGATOR_THINKING` is exposed for experiments; the measured default is "leave unset".


## Update: the guided tour, measured chapter by chapter (2026-10-28, evening)

Four model chapters in one conversation on Saleor (3 → 6, "add a delivery note to checkout"), model default thinking.

| Stage | Chapter times (s) | Total | Claims (verified / contradicted / other) |
|---|---|---|---|
| Start of the day | 52 · 103 · 156 · 122 | **433 s** | mostly unverifiable |
| After the first guards + location claims | 52 · 103 · 156 · 122 (same loop) | 433 s | 4/4, 4/6, 6/7, 2/4 |
| After the fixes below | **60 · 36 · 34 · 63** | **193 s** | 2/4 · 5/5 · 5/5 · 5/8 (2 contradicted: real model mistakes) |

What the real runs found, in order:

1. **A degenerate reply, not slow thinking.** With the final call forced to `submit_answer`, the model answered with **256–280 identical tool calls in one reply** (`finish: length`, 4,096 output tokens). The loop answered each one, so the history grew 16k → 56k input tokens over three rounds at 16–24 s each. Fix: forced rounds ask for one call (`parallel_tool_calls: false`) and **at most 8 calls (1 when forced) are accepted from any single reply**. Measured on the same chapter: model time 92 s → 21 s, input 200k → 113k tokens, every round 1–5 s.
2. **Heavy reads repeated.** `get_service` (660 KB, ~4 s) was fetched by the tool, by `consumers_of` and once per relation claim. It is now read once per investigation; the structural topology is built in parallel with the investigation and reused for 5 minutes.
3. **A bug the tests could not see:** memoising the adapter with `{...lain}` dropped every method of the real client (it is a class; the test mock is a plain object), so the model could not read code and every claim became "supported/unsupported". Found because verification suddenly fell to zero in the real run; fixed with a `Proxy` and a class-based test.
4. **Verification fixes:** a path with the repo name added or dropped is tried both ways (Saleor's repo has a top-level folder with the same name); a location claim can cite an engine evidence id that resolves to the same `path:line` (the engine's synthetic names like `graphql-call:mutation:x` are not literal source text); the prompt says to copy paths exactly as the tool printed them and never to guess a line.
5. **Chapter 3 asked for the impossible** ("trace ONE request" for a feature that does not exist yet). It now traces the closest existing request in at most five hops and stops at the first hop it cannot find.

The remaining wait is the model reading code (34–54 s per chapter) plus the engine; the UI shows what is happening and for how long.
