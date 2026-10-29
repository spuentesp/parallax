# Agent quality: web orientation, playbooks, retrieval, traces

Order agreed: measure first, then the cheap lever, then the new source, then retrieval.

## Done (offline-tested)

| Piece | Where | Notes |
| --- | --- | --- |
| Measurement | `scripts/eval-saleor.ts` (`type` per case, per-type summary, `--no-playbooks` baseline); `src/docs/recall.ts` + `test/docs-recall.test.ts` (recall@k over a fixture repo through the real index path) | Eval set is still the 4 Saleor cases: growing it needs a live Lain engine. |
| Trace persistence | `drizzle/0007_turn_trace.sql`, `turn.trace_json`, `src/agent/trace-log.ts`, written by `/api/query` | Tools, tokens, claim verdicts, `allVerified`. No result text. Not exposed by any read route. |
| Playbooks (few-shot) | `src/agent/playbooks.ts` | Deterministic question classifier, one short example per type, injected into the first user message only. Prompt version v10. |
| Web search (Tavily) | `src/agent/web-search.ts`, dispatcher tool `web_search`, `TAVILY_TOKEN` | Absent without a key. Official domains first, internal names scrubbed, 2 calls max. Results are indexed (repo `web`, path = URL) and cited with the existing `doc_quote` claim, so the verifier reads back what the model saw. A URL the web never returned is `contradicted`. |
| Retrieval | `ftsQuery` splits camelCase / snake_case identifiers into words | recall@3 on the fixture: 7/8 -> 8/8. |

| Official docs list | `drizzle/0008_official_docs.sql`, `src/docs/official.ts`, `/api/workspaces/:id/official-docs` | Per workspace, in SQLite, seeded from `DEFAULT_OFFICIAL_DOCS` on first read; GET (read), POST / DELETE / `reset` (write). What a workspace changes is what `web_search` restricts to on its next question. Emptying the list on purpose is not re-seeded. |
| Tavily result quality | `cleanPages`, `advanced` depth when restricted | No translations, rendered source, #fragment duplicates; stale versions and release notes last. |

## Not done

- Eval growth to 40+ questions (needs the live engine; add cases by `type`, keep them out of `playbooks.ts`).
- Retrieved exemplars (needs accepted traces: `trace_json.allVerified`).
- Query expansion from Lain symbols (needs an engine call before the hint; measure with live data first).
- UI to edit the official docs list (API only for now).
- Rate limit / spend accounting for Tavily searches; a persistent search cache (ingested pages are searchable by `find_docs`, which is the de facto cache).

## Measure it (needs live services)

```
# baseline vs playbooks, per question type
pnpm --filter @parallax/api exec tsx --env-file-if-exists=../../.env scripts/eval-saleor.ts --no-playbooks <worker-model>
pnpm --filter @parallax/api exec tsx --env-file-if-exists=../../.env scripts/eval-saleor.ts <worker-model>
```
