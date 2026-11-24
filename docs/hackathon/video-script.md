# 3-minute pitch video — script (v3, Parallax 0.2.0, Lain 0.16.1, NVIDIA clusters)

Target: **about 3:15**. This version follows the footage `docs/hackathon/record-demo.mjs` records, in the order it records it
(the clips are not in the order of the earlier drafts). Timings were read from a contact sheet at 8 s steps: about ±5 s.
About 2.5 spoken words a second. Record the voice-over after the capture; no music, or music you have the licence for.

**Before recording:** open the demo once so the machine is warm, close notifications, stay on one theme. Use the read-only link.
Demo: `https://marbled-river-9619.fly.dev/orgs/ws_cluster_a?token=<READ_ONLY_TOKEN>` (Cluster B: `/orgs/ws_cluster_b`).
Capture: `PLAYWRIGHT_CORE=<path> node docs/hackathon/record-demo.mjs <BASE_URL> <READ_ONLY_TOKEN> <OUT_DIR>`. Each Ask starts in a
fresh conversation. The Asks take 40 to 60 s: the web-search block is written to be spoken over that wait.

---

### 0:00–0:32 — Map
*Screen: the Cluster A map fits to view, then repos, services, endpoints.*
> "I just joined a team that builds on NVIDIA's agent stack. I don't know which repos matter, which services call which, or what breaks if I change something. Normally that's two weeks of asking people. This is Parallax, pointed at three of NVIDIA's public repos: OpenShell, NemoClaw and NeMo-Fabric. Repos, then services, then every endpoint, drawn from the code itself."

### 0:32–0:46 — Query
*Screen: the Query page, the gRPC preset, Run.*
> "For the raw graph there's a read-only query page. Here, every gRPC call site, grouped by the service that provides it. No model involved. This is the engine's own answer, with a count after every step."

### 0:46–1:02 — Coverage
*Screen: the four tiles, the "real gaps" breakdown, the sensor table.*
> "And the honest part. For every repo: which analyses ran, and where the engine is blind. It says outright that it does not claim complete coverage. So 'no impact' is only ever claimed over code it could actually read."

### 1:04–1:40 — Ask, and every claim is checked
*Screen: "Which services consume the OpenShell gRPC gateway, and from which repos?" is typed; tool calls scroll; the answer lands with verdicts (for example "3 verified · 1 unverifiable").*
> "Now I ask what I'm walking into: which services consume the OpenShell gRPC gateway, and from which repos? Nemotron, running on Nebius Token Factory, investigates with the code analysis engine's tools. It answers, and every relationship it claimed is re-checked by the engine. Three verified, one unverifiable. The model doesn't decide what's true. The engine does, and it flags what it can't confirm."

*(Say the verdict counts that are on screen; they can differ by a take.)*

### 1:40–2:00 — Show on map, and the inspector
*Screen: "Show on map"; the inspector with "Consumed by 3 services across 2 repos".*
> "One click takes me to the exact part of the architecture behind the answer. The inspector lists who consumes this service, across repos, and how each link is known: deterministic here, proven by static analysis."

### 2:00–2:16 — Proven and inferred
*Screen: the Inferred and Proven toggles.*
> "Solid lines are proven. Dashed lines are inferred, and Parallax labels them that way. It never promotes a guess to a fact."

### 2:16–3:10 — Web search, and how it's built
*Screen: the question, "Investigating…" with its steps, then the answer with its verdicts.*
> "For general technical questions it can search the web, official documentation first. I'll ask what gRPC server reflection is, and whether any of our services expose it. While it works, you can see each step. Nemotron 3 Super plans, Nemotron 3.5 Lightning does the fast reads, both through Nebius Token Factory, in a tool-calling loop with a hard budget. The answer separates what the documentation says from what the code shows, and the engine checks the code part."

### 3:10–3:17 — Close
*Screen: hold on the final answer; add an end card with the repo and demo URLs in your editor.*
> "Knowledge locked in people's heads, made navigable and verifiable. That's Parallax: if it's in your org's code, it can guide you."

---

### Real numbers you can quote (measured on the deployed demo, Lain 0.16.1)
- **Cluster A** (OpenShell, NemoClaw, NeMo-Fabric): 5 services, 203 endpoints, 52 dependencies.
- **Cluster B** (NeMo Agent Toolkit, UI, examples): 3 services, 27 endpoints, 2 dependencies.
- An Ask on the deployed demo takes about a minute (40 to 60 s measured).
- ~2,200 tests; every Ask's claims are re-checked by the engine.

### Keep it honest (do not say these)
- Do **not** say the app runs on Nebius AI Cloud: the model calls go to Nebius Token Factory; the demo is hosted on Fly.io.
- Do **not** claim the web answer cites grpc.io, or name which service exposes server reflection: both vary from run to run.
- Do **not** claim a weekly digest across repos or team ownership ("which services belong to sales"); those are roadmap. Say "gRPC gateway" or another name-based concept.
- Cluster A's coverage is not complete (the engine says so on the Coverage page); say that, it is the point.
- The Query page has no natural-language "Translate" box yet.

### Shot list checklist (in recorded order)
- [ ] Map fit to view, repos → services → endpoints · [ ] Query → gRPC preset → Run · [ ] Coverage health + blind spots · [ ] Ask + verdicts · [ ] Show on map + inspector "Consumed by" · [ ] inferred vs proven · [ ] web-search Ask · [ ] end card with URLs (add in the editor)
- Not in the capture: drilling repo → file. Record it by hand if you want it.
