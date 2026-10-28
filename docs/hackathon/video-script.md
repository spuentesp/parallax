# 3-minute pitch video — script

Target: **2:45–2:55**. Record the screen at 1080p, voice-over after (re-recordable). No music, or music you have the licence for. No third-party logos on screen other than the product itself (Saleor is open source; it is fine to show its name).

**Before recording:** warm the map cache (open the map once), pre-run the two questions below so Nemotron answers fast, check `NEBIUS_TOKEN` works on the demo host, close notifications, light **or** dark theme — pick one and stay on it.

---

### 0:00–0:20 — The problem (talk to camera or title card)
> "I just joined a company. I'm assigned to checkout. I don't know the stack, I don't know which repos matter, I don't know what depends on what. Normally I'd spend two weeks asking people. Architects have the same problem at a bigger scale: a service mesh nobody fully understands. Knowledge silos. Parallax is built to destroy them."

*(Screen: the Parallax map, zoomed out, repos only.)*

### 0:20–1:10 — New engineer: ask
> "I ask Parallax what I'm walking into."

Type: **"Which services consume the checkout API, and from which repos?"**
> "Nemotron, running on Nebius Token Factory, investigates using the code analysis engine's tools. It answers — and look at this: every relationship it claimed was checked by the engine. Verified. Contradicted. Unverifiable. The model doesn't decide what's true; the engine does."

Click **Show on map**.
> "And it takes me to exactly the part of the architecture that backs the answer."

### 1:10–1:55 — Architect: explore
> "Now I'm the architect. I want the whole picture."

*(Zoom out → open a repo → open a service → endpoint → Code → a file → a function.)*
> "Repos, services, endpoints, then the code itself — functions inside files inside the repo. All loaded on demand, so it scales."

*(Toggle **inferred** only, then **deterministic**.)*
> "Solid lines are proven by static analysis. Dashed lines are inferred, fainter the less sure the engine is. Parallax never promotes a guess to a fact."

*(Select an endpoint; inspector shows Consumed by.)*
> "Click any endpoint: who consumes it, across repos, and how sure we are."

### 1:55–2:25 — Change impact
*(Assessments → a PR report.)*
> "Before a change ships: what does this pull request break in other repos? The engine decides the facts — which consumers, how severe — and Nemotron explains them, by finding, so nothing is invented."

### 2:25–2:50 — How it's built (quick, for the judges)
*(Show a short architecture diagram or the investigator's tool-call trace.)*
> "Nemotron 3 Super plans, Nemotron 3.5 Lightning does the fast work, both through Nebius Token Factory, in a tool-calling loop with a hard budget. Every explanation is stored with the model, prompt and tool calls, so it's auditable. The app runs on Nebius."

### 2:50–3:00 — Close
> "Knowledge locked in people's heads, made navigable and verifiable. That's Parallax: if it's in your org's code, it can guide you."

*(End card: repo URL + demo URL.)*

---

### Keep it honest (do not say these — they are not built yet)
- Do **not** claim a "what happened this week across all repos" digest, or that it knows which *team* owns a service / which services "belong to sales". Say "checkout" or another name-based domain.
- If asked in Q&A: PR impact is per-PR today; ownership metadata and digests are the roadmap.

### Shot list checklist
- [ ] Map zoomed out (repos) · [ ] ask + verdicts + Show on map · [ ] drill repo→function · [ ] inferred vs deterministic filter · [ ] inspector "Consumed by" · [ ] PR assessment · [ ] architecture/trace slide · [ ] end card with URLs
