# Parallax for Atlassian: testing instructions

Parallax gives Jira and Confluence a map of the software behind the work: which services
exist, who depends on them, and how sure we are. It reads the real code graph (built by
[Lain](https://github.com/spuentesp/lain)) and turns it into blast-radius answers, and into
Confluence pages that stay in sync with the code while keeping what people wrote by hand.

## How it is built (read this first)

Parallax for Atlassian is a **plugin plus a server**.

| Part | What it is | Where it runs |
|---|---|---|
| **Forge app** `parallax-codegeist` | The plugin you install. Adds tools, Confluence pages and (soon) Jira panels. | Atlassian Forge, on your site |
| **Parallax server** | Fastify API + the Lain code-graph engine, already indexed on two demo workspaces. | Fly.io: `https://marbled-river-9619.fly.dev` |

**The Forge app needs the Parallax server to be running.** Every tool calls it through one
declared outbound domain, `marbled-river-9619.fly.dev`. If the server is down, tools answer
with an error instead of data.

Check the server before you start:

```
curl https://marbled-river-9619.fly.dev/api/health
# expected: {"status":"ok","version":"0.2.0","lainAdapter":"real","apiVersion":"1","analyzerVersion":"0.16.1"}
```

The server stays up through judging. A cold start after a restart takes about a minute. To run
your own copy instead, see [`deploy/fly/README.md`](../../deploy/fly/README.md); the only change
in the Forge app is the domain in `packages/forge/manifest.yml` and the `BACKEND` constant in
`packages/forge/src/index.js`.

## What you need

- An Atlassian site with **Jira and Confluence**, where you are a **site admin**.
  The free Codegeist development site (`forge site provision`) works.
- Optional: an MCP client such as Claude Code, to call the tools from outside Atlassian.

## 1. Install (about 2 minutes)

1. Open the installation link from the submission.
2. Choose your site and install on **Jira**. Open the link again and install on **Confluence**.
   **Install on both**: pages are written to Confluence and linked from Jira.
3. Review the permissions screen: Parallax reads and writes Confluence pages, labels and content
   properties. It does not read Jira issues in this version.

## 2. Turn on the tools (about 1 minute, admin)

External exposure of Forge tools is off by default (Atlassian's rovo:mcp Preview).

1. Go to <https://admin.atlassian.com> and select your site.
2. Open **Connected apps**, choose **parallax-codegeist**, then **View app details**.
3. Under **Tools**, choose **Expose tools to MCP-compatible apps** > **Enable tools**.

## 3. Use it

### Option A: the Parallax Architect agent in Rovo (nothing else to install)

The app ships a Rovo agent. Open Rovo (<https://home.atlassian.com> > your site > **Chat**), go to
**Agents**, search for **Parallax Architect** (app: parallax-codegeist) and start a chat. Try:

- "Which Parallax workspaces are available?"
- "What breaks if I change the openshell-gateway service in the ws_cluster_a workspace?"
- "Document the nemoclaw service in Confluence space `<KEY>`"

The agent chains the tools below, states whether each dependency is proven by code or only inferred,
and names the owner when a Confluence page has one. If it says it has no tools, complete step 2.

### Option B: an external MCP client

The MCP endpoint for this app is:

```
https://mcp.atlassian.com/forge/9fe4925c-2d52-4c10-b231-f5bf5a9df465
```

With Claude Code:

```
claude mcp add --transport http parallax https://mcp.atlassian.com/forge/9fe4925c-2d52-4c10-b231-f5bf5a9df465
```

Run `/mcp`, pick `parallax`, and sign in. Choose your site on the consent screen.

You can also add the tools to your own agent in **Rovo Studio** (Tools > Add tools >
Connected apps > parallax-codegeist).

| Tool | Ask it | You get |
|---|---|---|
| `parallax-list-workspaces` | "Which Parallax workspaces exist?" | `ws_cluster_a` (OpenShell stack), `ws_cluster_b` (NeMo Agent Toolkit) |
| `parallax-briefing` | "Brief me on ws_cluster_a" | Services, entry points, who uses what |
| `parallax-find` | "Find CreateSandbox in ws_cluster_a" | Matching endpoints and their node ids |
| `parallax-node-impact` | "What breaks if I change svc:openshell-gateway?" | Consumers with proof level, endpoints used, call sites and, when present, the owner written on their Confluence page |
| `parallax-contract-detail` | "Show the contract for `rpc:openshell.compute.v1.ComputeDriver/AuthenticateSandbox`" | Providers, request and response schema, consumers |
| `parallax-publish-service-doc` | "Document svc:openshell-gateway in Confluence space `<KEY>`" | Creates or updates a Confluence page |

Every consumer edge carries a proof level: **deterministic** means the code proves it,
**inferred** means a heuristic found it and a person should check.

## 4. Try the two-way pages

1. Ask for `parallax-publish-service-doc` for `svc:nemoclaw` in any space you own (use its **space
   key**, for example `~youraccount` for a personal space). The first call asks you to consent to
   Confluence access; open the link it returns and approve, then repeat.
2. Open the new Confluence page **Service architecture: nemoclaw**. It is tagged with MACHINE
   MADE, PARALLAX and LAIN lozenges and the labels `parallax`, `lain`, `machine-made`.
   A page **Parallax Template: Service** was created in the same space: edit it to change the
   layout of every generated page.
3. Scroll to **Human notes**. Fill in **Owner** and **Criticality**.
4. Run the publish tool again. The machine part refreshes; **everything under Human notes stays**.
5. Ask for the blast radius of `svc:openshell-gateway` again. The `nemoclaw` consumer now returns
   the owner and criticality you wrote.

A page that Parallax did not create is never overwritten, even if it has the same title.

## Limits you should know

- The demo data are two public NVIDIA code clusters, indexed at pinned commits. Parallax does
  not index your own repositories in this build.
- Confluence pages are written as the calling user, so Confluence's own space permissions apply.
- External MCP exposure and `rovo:mcp` are Atlassian Preview features.
- The Forge app is not eligible for "Runs on Atlassian": it calls an external server by design.

Source: <https://github.com/spuentesp/parallax> (MIT) · Support: <https://github.com/spuentesp/parallax/issues> ·
Privacy: <https://github.com/spuentesp/parallax/blob/main/docs/codegeist/privacy.md>
