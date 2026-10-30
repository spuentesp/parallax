# 3-minute pitch video — script

Target: **2:32** of narration + ~10s outro = **~2:42** total runtime.
Format: 1080p (1920x1080), dual-voice AI narration synced to Playwright browser automation.

---

### Cast & Character Structure
- **Junior Engineer (Brian — `en-US-BrianNeural`):** Speaks only at the beginning (Scene 1 hook and Scene 2 question). Sets up the relatable dev friction without dragging.
- **Lead Architect (Ava — `en-US-AvaNeural`):** Primary guide and technical narrator from Scene 2 onward. Confident, conversational, and authoritative across the entire product demo and closing punchline.

---

### Master Audio Timeline (`docs/hackathon/video/audio-timeline.json`)

#### Scene 1: The Problem (0:00 – 0:20)
- `0:00 - 0:07` **Junior (Brian):**
  > "I just joined an AI agent platform team working on NVIDIA's OpenShell and NeMo stack. I don't know the service mesh, which repos matter, or what depends on what."
- `0:07 - 0:19` **Architect (Ava):**
  > "Normally, that's two weeks of bugging seniors. And at architect scale, it's an undocumented cross-repo mesh. Parallax turns that tribal knowledge into an explorable reality."
*(Visual: Zoomed-out map showing top-level repos; gentle camera pan across service clusters)*

#### Scene 2: The Question & The Engine (0:20 – 1:00)
- `0:20 - 0:27` **Junior (Brian):**
  > "So I ask Parallax: Trace the call stack from our database ORM table up to the client endpoint consuming it."
  *(Visual: Types question into the investigator search box, presses enter)*
- `0:27 - 0:37` *(UI Pause: Nemotron streams investigation tool calls)*
- `0:37 - 0:53` **Architect (Ava):**
  > "Watch Nemotron investigate using the code analysis engine's tools. Look at the result: every relationship it claims was checked by the engine. Verified. Contradicted. Unverifiable. The model doesn't decide what's true; the engine does."
  *(Visual: Highlight engine verification verdict badges)*
- `0:55 - 1:00` **Architect (Ava):**
  > "Click Show on map, and it takes us directly to the architecture backing the answer."
  *(Visual: Clicks 'Show on map' -> camera glides to OpenShell gateway subgraph)*

#### Scene 3: The Architecture Canvas & Deep Call Stack (1:03 – 1:40)
- `1:03 - 1:15` **Architect (Ava):**
  > "Now I want the whole picture. Repos, services, endpoints, down to the actual functions. Everything is loaded on demand, so even massive monorepos scale smoothly."
  *(Visual: Drills down repo -> service -> endpoint -> file -> function, stepping 8 frames from dispatch_agent_job to SandboxSessionTable)*
- `1:19 - 1:30` **Architect (Ava):**
  > "Solid lines are proven by static analysis. Dashed lines are inferred, fainter the less sure the engine is. Parallax never promotes a guess to a fact."
  *(Visual: Toggles filter between deterministic proven edges and heuristic inferred edges)*
- `1:33 - 1:39` **Architect (Ava):**
  > "Click any endpoint to see who consumes it across repos, and how confident we are."
  *(Visual: Clicks an endpoint node; inspector drawer slides out showing consumers and CallStackStepper)*

#### Scene 4: Blast Radius & PR Safety (1:43 – 2:02)
- `1:43 - 1:57` **Architect (Ava):**
  > "Before code ships: what does this pull request break downstream? The engine determines the blast radius and severity, while Nemotron explains the impact finding by finding—no invented regressions, zero hallucinations."
  *(Visual: Navigates to PR assessment report, reviews downstream impact breakdown)*

#### Scene 5: Under the Hood (2:02 – 2:22)
- `2:02 - 2:18` **Architect (Ava):**
  > "Under the hood: Nemotron Super plans the investigation and Lightning handles fast tool execution through Nebius Token Factory. Every tool call and prompt version is saved to the audit log. The entire platform runs on Nebius."
  *(Visual: Investigator audit drawer / tool trace showing Nemotron planning + execution tokens)*

#### Scene 6: Close (2:22 – 2:32)
- `2:22 - 2:29` **Architect (Ava):**
  > "Knowledge locked in people's heads, made navigable and verifiable. That's Parallax: if it's in your org's code, it can guide you."
*(Visual: End card with GitHub Repo URL and live demo URL)*

---

### File Locations
- **Master Audio:** [`docs/hackathon/video/audio/master_voiceover.mp3`](file:///home/sebastian/repos/work/parallax/docs/hackathon/video/audio/master_voiceover.mp3)
- **Timeline Cues:** [`docs/hackathon/video/audio-timeline.json`](file:///home/sebastian/repos/work/parallax/docs/hackathon/video/audio-timeline.json)
- **Audio Generator:** [`docs/hackathon/video/scripts/generate-voiceover.py`](file:///home/sebastian/repos/work/parallax/docs/hackathon/video/scripts/generate-voiceover.py)
- **Video Builder:** [`docs/hackathon/video/scripts/build-video.sh`](file:///home/sebastian/repos/work/parallax/docs/hackathon/video/scripts/build-video.sh)
- **Playwright Recorder:** [`docs/hackathon/video/scripts/record-pitch.ts`](file:///home/sebastian/repos/work/parallax/docs/hackathon/video/scripts/record-pitch.ts)
