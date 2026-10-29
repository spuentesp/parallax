# Feedback on Nebius Token Factory / NVIDIA tools — fill with what actually happened

The "Most Valuable Feedback" prize is judged on completeness, viability and potential impact. Write specifics, not praise. Prompts (delete the ones that don't apply; add measurements you have):

**Token Factory**
- Setup friction: key creation, credits (Builder Program), base URL, model ids (`nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3_5-Lightning`).
- Tool calling: reliability with `tool_choice`, parallel calls, malformed arguments — how often? (Parallax retries and reports `failed:` statuses.)
- Latency / throughput for a 6–8 call investigation; rate limits hit.
- Errors that were hard to diagnose (status codes, bodies).

**Nemotron models**
- Super vs Lightning in our measurements: in a PR-explanation fixture with 5 known findings, Super mentioned 6/15 findings and passed 0/3 runs before we passed the findings in explicitly; Lightning mentioned 12/15 but spent ~15 tool calls rediscovering the diff and promoted engine classes in every run (see `docs/superpowers/specs/2026-10-27-pr-explanation-design.md`).
- Instruction following on a strict final tool (`submit_answer`): schema errors, resubmits.

**What would have helped**
- Docs, examples for tool-calling loops, a model-selection guide per role (planner vs worker), usage/cost visibility per request.
