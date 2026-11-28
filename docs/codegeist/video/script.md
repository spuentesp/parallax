# Codegeist demo video: script

Target 4:15, hard limit 5:00. Narration by MiniMax TTS (`speech-2.8-hd`). Leads with the
**Best app with Atlassian MCP** bonus. Every shot is the live app: the production Forge install on
`one-atlas-bhik.atlassian.net`, the Fly server `marbled-river-9619`, and Claude Code connected to the
app's MCP endpoint. No mock server, no new assessments (only the four analysed PRs).

On-screen rules: no URL bar (the console link carries a token), no secrets in terminal shots, no
third-party logos, no music.

| # | Scene | Visual (one clip each, waits on visible text) | ~Time |
|---|---|---|---|
| 1 | Hook | Jira issue OSP-10, description in view | 0:20 |
| 2 | Jira panel | Open **Parallax impact** on OSP-10, scroll: prediction graph, PR headline, Talk to, next steps | 0:50 |
| 3 | MCP | Terminal: Claude Code calls `parallax-node-impact`, then `parallax-ticket-review` on OSP-10's text | 0:60 |
| 4 | Confluence | Page "Service architecture: nemoclaw": lozenges, generated sections, Human notes with Owner | 0:35 |
| 5 | Rovo agent | Ask Rovo > @Parallax Architect: "What breaks if I change the openshell-gateway service in ws_cluster_a? Who should I talk to?" | 0:20 |
| 6 | How it works | Architecture slide (Forge > one egress domain > Fly: API + two Lain engines), then the web console map and a live `/api/health` | 0:40 |
| 7 | Close | Title card: Parallax for Atlassian, install link note | 0:15 |

## Narration

### 1. Hook
A ticket says: remove the ListSandboxTemplates RPC. Simple enough. But who calls it? In a stack of
services spread across repositories, that answer usually lives in one person's head. Parallax puts it
next to the ticket.

### 2. Jira panel
This is the Parallax impact panel, a Forge app on the Jira issue. First, what the ticket predicts.
Parallax reads the ticket, finds the services and endpoints it names in the real code graph, and
draws who depends on them. A solid green line is proven by the code. A dashed amber line was inferred,
and a person should check it.

Then the pull request the ticket links, here a labelled demo pull request on our fork. Parallax
compared its base and head across every repository in the workspace. The headline says how the two
differ: the pull request touched exactly what the ticket named. One breaking change,
ListSandboxTemplates removed, and one consumer that the engine proves is using it. Below that: who to
talk to, and what to do next. A language model writes the explanation; every fact in it comes from
the code graph.

### 3. MCP
The same answers work outside Atlassian. The app exposes eight tools through the Atlassian MCP server,
with the rovo:mcp module. Here, Claude Code, signed in through Atlassian, asks what breaks if the
OpenShell gateway changes. The tool returns every consumer, the endpoints it calls, the call sites,
and a proof level for each edge: deterministic when the code proves it, inferred when a heuristic
found it. When a service has an owner written on its Confluence page, the owner comes back too.

Now paste the ticket. The review tool returns the prediction, the pull request's real analysis, and
the drift between them. A coding agent learns the blast radius before it writes the change.

### 4. Confluence
Documentation that keeps up with the code. Parallax publishes one Confluence page per service, from a
template you can edit. Generated pages are clearly marked as machine made. Under Human notes, people
write what the code can't say: the owner, the criticality. Publish again, and the generated part
refreshes while the human part stays. And it flows back: the owner written here is the one the Jira
panel and the tools report.

### 5. Rovo agent
Inside Atlassian, the Parallax Architect agent in Rovo chains the same tools, so anyone on the team can
ask in plain language. It answers with the consumers the code proves, the owner and criticality people
wrote in Confluence, and a link to the service's page.

### 6. How it works
How it works. The Forge app runs on Atlassian and calls one declared outbound domain: a Parallax
server on Fly.io. One machine runs the Parallax API and two Lain code-graph engines, one per code
cluster, over public repositories at pinned commits. Lain indexes the code, links services through
their contracts, gRPC and HTTP, and compares a pull request's base and head snapshots. The graph is
built into the image, so a restart restores it in about a minute instead of indexing from scratch.
Parallax adds the product on top: predictions, drift, pages, and its own web console.

### 7. Close
Parallax for Atlassian: the code's real architecture, next to the work that changes it. Know what a
change will touch, and who to talk to, before it ships.

## Pipeline

1. `record-*.mjs`: one Playwright clip per Atlassian/console scene (headless, 1920x1080, session
   copied from the Orca browser into the scratchpad, never into the repo). Scene 3 is an
   `asciinema` take of Claude Code, played back in the browser at 1080p.
2. `mmx speech synthesize` per scene; clip speed is fitted to its narration with ffmpeg.
3. ffmpeg concat into `parallax-codegeist-1080p.mp4`. Media lives in `docs/codegeist/video/out/`
   (gitignored).
