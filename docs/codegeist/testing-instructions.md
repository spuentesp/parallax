# Parallax for Atlassian: testing instructions

Parallax gives Jira and Confluence a map of the software behind the work: which services
exist, who depends on them, and how sure we are. It reads the real code graph (built by
[Lain](https://github.com/spuentesp/lain)) and turns it into blast-radius answers, and into
Confluence pages that stay in sync with the code while keeping what people wrote by hand.

## How it is built (read this first)

Parallax for Atlassian is a **plugin plus a server**.

| Part | What it is | Where it runs |
|---|---|---|
| **Forge app** `parallax-codegeist` | The plugin you install. Adds a Jira issue panel, a Rovo agent, MCP tools and Confluence pages. | Atlassian Forge, on your site |
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

1. Open the installation link from the submission. It shows the app's permissions; click **Get app**.
2. Choose your site. Under "Select any additional Atlassian apps", **tick Confluence** as well as
   Jira, then **Install**. Pages are written to Confluence and linked from Jira, so install on both.
   (If you install on Jira first, open the link again to add Confluence.)
3. Review the permissions: Parallax reads and writes Confluence pages, labels and content
   properties, and **reads Jira issues** (summary, description, comments, links) as the person
   viewing them, to power the issue panel. It never writes to Jira. See [privacy.md](privacy.md).
   The first time you use a feature, Atlassian may ask you to approve the app's access: approve it.

## 2. Turn on the tools (about 1 minute, admin)

External exposure of Forge tools is off by default (Atlassian's rovo:mcp Preview).

1. Go to <https://admin.atlassian.com> and select your site.
2. Open **Connected apps**, choose **parallax-codegeist**, then **View app details**.
3. Under **Tools**, choose **Expose tools to MCP-compatible apps** > **Enable tools**.

## 3. Use it

### Option A: the Parallax impact panel on a Jira issue

The panel compares what a ticket *predicts* with what its pull request *actually changed*.

1. In any Jira project, create an issue and paste one of the five tickets below as its
   description (the first line is the summary).
2. Open the issue. **The panel is not shown by default.** On the icon row under the issue title,
   click the **Parallax impact** button (a blue icon; in some issue views it is under the **Apps**
   hexagon menu). The panel opens in the issue content, below the description. It works in Jira
   Software, Work Management and Jira Service Management projects.
3. Read it top to bottom: who to talk to, a graph of what the ticket's words point at (green
   solid line = proven by code, amber dashed = inferred, red dot = criticality), then the
   pull request's real analysis with a one-sentence headline of how the two differ, and a ranked
   list of next steps.

Tickets to paste (four pull requests are analysed: two real, merged ones and two clearly
labelled synthetic demos; **any other pull request link shows "has not been analysed yet"**):

**A. A PR that edits risky code and touches an interface file**

> Keep pool sandbox sessions on their supervisor's gateway
>
> Pool sandbox sessions should stay on the gateway of their supervisor. We expect to change rpc openshell.v1.OpenShell/ConnectSupervisor in the openshell-gateway service.
>
> Pull request: https://github.com/NVIDIA/OpenShell/pull/5052

Expected headline: "The PR changed no contracts, but edited 10 code symbols in OpenShell (highest
risk: high; 7 untested). Also: 9 methods in changed interface files could not be compared."

"Could not be compared" is deliberate: the engine cannot extract a schema for streaming methods, so
it flags every such method in an interface file whenever that file changes, even for a comment
edit. Parallax reports those separately and never calls them contracts the PR touched.

**B. A code-only change with risky edits and no contract change**

> GetProviderProfile returns stale data after UpdateConfig
>
> After rpc openshell.v1.OpenShell/UpdateConfig, rpc openshell.v1.OpenShell/GetProviderProfile can return the previous profile for a few seconds. The nemoclaw service reads provider profiles through its OpenShell adapter.
>
> Pull request: https://github.com/NVIDIA/NemoClaw/pull/13812

Expected headline: "The PR changed no contracts, but edited 2 code symbols in NemoClaw (highest risk: high; 1 untested)."

**C. A synthetic demo PR that makes a wire-compatible change**

> Remove the labels map from the CreateSandbox request
>
> Labels will be set after creation instead. Remove the labels map from rpc openshell.v1.OpenShell/CreateSandbox in the openshell-gateway service.
>
> Pull request: https://github.com/spuentesp/openshell/pull/1

That pull request is a labelled demo on a fork (do not merge): it removes one field. Expected: the
prediction graph shows `openshell-sdk` depending on `CreateSandbox` (the SDK sets `labels=`), and
the headline says the engine found no definite contract change and counted one wire-compatible
change that it does not list individually.

**D. A synthetic demo PR that removes an RPC (the one with a proven consumer)**

> Remove the ListSandboxTemplates RPC
>
> Sandbox templates are being managed through config instead. Remove rpc openshell.v1.OpenShell/ListSandboxTemplates from the openshell-gateway service.
>
> Pull request: https://github.com/spuentesp/openshell/pull/2

That pull request is also a labelled demo on a fork (do not merge). Expected headline: "The PR
touched exactly what the ticket named (1 contract change). Proven by the engine:
ListSandboxTemplates was removed (breaking) and 1 consumer in OpenShell is proven to use it. Also:
8 methods in changed interface files could not be compared." This is the only analysis with a
**proven** (Verified) finding.

**E. A prediction only, no pull request yet**

> Change the ListSandboxes default page size from 50 to 25
>
> rpc openshell.v1.OpenShell/ListSandboxes on openshell-gateway returns up to 50 sandboxes by default. Halve the default.

Only the prediction and its graph are shown. All reports are honest about their limits:
"needs investigation" means the engine could not prove or rule out an impact, and the panel
says so when coverage is incomplete.

**To see an owner in "Talk to":** first do section 4 below (publish the `nemoclaw` page and fill in
**Owner**), then refresh the panel. The owner you wrote appears.

### Option B: the Parallax Architect agent in Rovo (nothing else to install)

The app ships a Rovo agent. Open Rovo (<https://home.atlassian.com> > your site > **Chat**), go to
**Agents**, search for **Parallax Architect** (app: parallax-codegeist) and start a chat. Try:

- "Which Parallax workspaces are available?"
- "What breaks if I change the openshell-gateway service in the ws_cluster_a workspace?"
- "Document the nemoclaw service in Confluence space `<KEY>`"
- Paste any of the tickets above and ask "What would this ticket affect, and how did its
  pull request compare?" The agent reviews the ticket and its pull request and finishes with the
  same next steps and contacts as the panel.

The agent chains the tools below, states whether each dependency is proven by code or only inferred,
and names the owner when a Confluence page has one. If it says it has no tools, complete step 2.

### Option C: an external MCP client

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
| `parallax-expected-impact` | Paste a ticket: "What would this affect?" | Services and endpoints the words point at, with consumers and proof level |
| `parallax-ticket-review` | Paste a ticket that links a pull request | The prediction, the pull request's real analysis, the drift between them, contacts and next steps |
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
- Only four pull requests have been analysed (OpenShell #5052, NemoClaw #13812 and the synthetic
  demos spuentesp/openshell#1 and #2). Others report "has not been analysed yet". Only the
  synthetic #2 contains a "Verified" finding: real OpenShell and NemoClaw changes mostly add to
  their interfaces, a removed proto3 field is wire-compatible, and the engine does not claim a
  proof it does not have.
- Confluence pages are written as the calling user, so Confluence's own space permissions apply.
- External MCP exposure and `rovo:mcp` are Atlassian Preview features.
- The Forge app is not eligible for "Runs on Atlassian": it calls an external server by design.

Source: <https://github.com/spuentesp/parallax> (MIT) · Support: <https://github.com/spuentesp/parallax/issues> ·
Privacy: <https://github.com/spuentesp/parallax/blob/main/docs/codegeist/privacy.md>
