# Devpost feedback form: draft answers

Every number below comes from [agent-spend.md](../agent-spend.md) or [feedback-notes.md](feedback-notes.md) (real runs on Saleor, Oct 28-29). Items marked **YOU** are opinions or facts only you can supply. I did not invent them.

---

## 1. Which model(s) did you use, and why that size/variant?

I used three Nemotron models through Nebius Token Factory, each for a different role:

- **Nemotron 3 Super 120B-A12B** (`nvidia/nemotron-3-super-120b-a12b`) as the **planner and writer**. It plans what to read, then writes the final answer and its claims. I chose it because the fast model failed at writing: wrong line numbers, invented operations, and answers without checkable claims.
- **Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`) as the **worker**. It runs the cheap, many-call tool-calling loop that reads code through the analysis engine.
- **Nemotron 3 Ultra 550B-A55B** is configurable for heavy reasoning. I did not use it in the measured runs.

I settled on a planner, worker, writer "relay" after measuring four setups (Lightning alone, Super alone, and two relay versions).

## 2. How would you rate Nemotron's output quality? (1-10) and what worked or fell short

**YOU: pick the number.** My suggestion from the evidence is **7**.

What worked:
- Tool calling in a multi-round loop was reliable enough to investigate cross-repo questions.
- With the relay, 4 test cases x 3 runs passed **10/12**, with **28 engine-verified claims and 0 contradicted**.
- Super with thinking off answered all 12 short classification cases (7/7 agreement with the thinking-on reference) in about 2 s and 253 tokens, versus 13 s and 3,277 tokens with thinking on.

What fell short:
- Lightning answered in prose instead of the required structured answer in 6 of 12 runs, and it invented GraphQL operations in one run (`attributeDetails`, `attributeList`).
- Lightning with thinking off produced unusable replies for 5 of 12 classification cases.
- In one forced-final-answer round the model emitted **256-280 identical tool calls in a single reply** (`finish: length`). I had to cap accepted calls per reply and set `parallel_tool_calls: false`.
- Super alone passed only 6/12.
- On a PR-explanation fixture with 5 known findings, Super mentioned 6/15 findings and passed 0/3 runs until I passed the findings in explicitly. Lightning mentioned 12/15 but spent about 15 tool calls rediscovering the diff.

## 3. Fine-tune, prompt-engineer, or out of the box?

**Out of the box. No fine-tuning.** The work was prompt and loop engineering:
- A tool-calling loop with a hard budget (tool calls and wall-clock).
- A typed final tool (`submit_answer`) with claims that the static-analysis engine re-checks (verified, contradicted, unverifiable).
- Duplicate-call refusal, per-tool caps, and forced delivery near the end of the budget.
- Selective use of `chat_template_kwargs.enable_thinking=false` for short structured replies only.
- A planner, worker, writer relay with a decision rule fixed before the runs.

## 4. How did Nemotron compare to other models?

**YOU: I have no measured comparison against non-Nemotron models in the repo.** Write only what you actually saw. What I can state truthfully is the comparison *between Nemotron variants* (section 2). If you tried other models for this task, add one honest sentence with what you saw.

## 5. Which Nebius capabilities were most valuable, and how?

**Token Factory** (OpenAI-compatible API at `api.tokenfactory.nebius.com/v1`) was the capability used at runtime for every model call. Details to include:
- Access through one API key (`NEBIUS_TOKEN`) and a standard chat-completions interface, so the existing tool-calling code needed only a base URL and model ids.
- Per-request usage is returned, and Parallax records `promptTokens`, `completionTokens` and `rounds` for every answer. That is how I found that cost is **input tokens** (every round resends the context): one question went from 502k input tokens to about 91-113k after the loop guards.
- **TODO: fill after deployment.** Describe the deployment honestly: a Nebius AI Cloud VM (instance type, region), running Parallax and the analysis engine behind HTTPS. Do **not** mention GPU instance types or Serverless Jobs unless you actually used them. The README currently claims a Serverless Job, which is not built.

## 6. How likely to recommend Nemotron on Nebius? (1-10)

**YOU.** Pick the number and give one reason you really hold. Possible honest angles from the evidence: the API worked with standard tooling and gave usage per call; the different model sizes let me match cost to role. If you hit timeouts, say so (the G3 release gate notes Lightning timed out during one live validation, so Super was used as the worker for that run).

## 7. Experience running Nemotron inference on Nebius vs previous environments (1-10)

**YOU.** I have no data on your previous environments. Add what you actually compared.

## 8. What would have made the experience more effective?

Concrete items I can support from the measurements:
- **Tool-calling guidance:** documentation and examples for tool-calling loops, including `parallel_tool_calls`, `tool_choice` and what to expect with long forced-tool rounds.
- **A model-selection guide per role** (planner vs worker vs writer), since the right split took measurement to find.
- **Per-request cost and token visibility in the dashboard**, in addition to the usage in each response.
- **Guard against degenerate repeated tool calls** (hundreds of identical calls in one reply) or documentation of the failure.
- **Thinking-mode controls:** clearer docs for `enable_thinking`, since it helps short structured replies about 13x in tokens but made the tool loop wander.

## 9. What do you most hope to see from the Nemotron team next?

Suggested, edit to match your view:
- More reliable structured output and strict final-tool compliance for smaller, faster models, so a cheap worker can also write claims.
- Stable, predictable tool-calling behavior under long contexts and forced tool choice.
- A published guide for planner/worker splits across Super, Lightning and Ultra.

## 10. Did you use Tavily?

**No.** I found no Tavily call in the code. Select **No**. The bonus needs a real runtime call, so don't select Yes unless one is added and works.

## 11. Builders & Brews IRL city

Your city is not on the participating list (Tokyo, Da Nang, Seoul, Kuala Lumpur, Singapore, Taipei, Tel Aviv, London, Copenhagen, Stockholm, Warsaw, Amsterdam, Berlin, Paris, Mexico City, New York City, Toronto, Boston, San Francisco, Los Angeles). **YOU:** select none/not attending, unless you attended one.

## 12. Checkboxes

- **Age of majority:** **YOU** confirm for yourself and any teammates.
- **Not an employee or agent of Nebius, Devpost or affiliates:** **YOU** confirm for yourself and any teammates.

## 13. Which AI tools did you leverage?

**YOU: confirm and complete.** Based on what I saw in your environment and this project:
- NVIDIA Nemotron 3 Super / 3.5 Lightning (via Nebius Token Factory) in the product.
- AI coding agents for development (I can see Claude Code and Antigravity were used on this machine; list the models you actually used).
- Lain, the static-analysis engine, as the code-graph backend (not an AI tool, but part of the stack).

## 14. Level of learning (dropdown)

**YOU.** If the options are on a scale, the honest evidence is substantial: I measured model behavior, found and fixed failures (degenerate tool calls, truncated writer output, adapter bug the tests couldn't see) and built a relay with a pre-registered decision rule.

## 15. Did you gain AI value you can use in your career? (dropdown)

**YOU.** The evidence supports "yes": evaluating agents against a deterministic checker instead of a model judge, budgeting tool-calling loops, and splitting planner/worker/writer roles.
