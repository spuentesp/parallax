# Privacy statement: Parallax for Atlassian

Last updated: 2026-11-24. This describes the `parallax-codegeist` Forge app and the Parallax
server it calls.

## What the app does with your data

| Data | What happens |
|---|---|
| **Confluence page titles, bodies and properties** | Read and written as the signed-in user, inside your site, to create Parallax pages and to read the Owner / Criticality / Runbook / Notes table. Page content is **not** sent to the Parallax server. |
| **Jira issues** | When you open the **Parallax impact** panel on an issue, the app reads that issue's summary, description, comments and linked-item addresses **as you** (Jira's permissions apply; scope `read:jira-work`) and analyses the text inside the Forge function. The full text is **not stored** and **not sent** to the Parallax server. Only words that look like code identifiers (method names, service names, HTTP routes) are sent, as search text. Links to GitHub pull requests are matched locally against stored analyses; the pull request address is not sent. |
| **Tool inputs you type** | Workspace ids, search text, node ids and contract keys are sent to the Parallax server so it can look them up in its code graph. |
| **Atlassian account data** | Not sent to the Parallax server. |

## What leaves Atlassian

The app declares one outbound domain: `marbled-river-9619.fly.dev` (the Parallax server).
Requests carry only the tool inputs above (including code-like terms from a ticket, never the
whole ticket) and a read-only access token that identifies the app, not you. Nothing else is
sent.

## What is stored

- **In Atlassian / Forge:** the app uses no Forge storage. Pages and content properties it
  creates live in your Confluence site and are yours to edit or delete.
- **On the Parallax server:** the server indexes public demonstration repositories. It stores no
  information about your site or users. Its operational logs (default Fastify request logs) can
  contain request paths and query strings, so the search text you type, and the code-like terms
  taken from a ticket, can appear there. Logs are used for troubleshooting only.

## Language model

The Parallax server can use a hosted language model (NVIDIA Nemotron through Nebius Token Factory)
to write short explanations of pull-request assessments. That input is public repository and
pull-request data from the demonstration repositories. **The Forge app's tools never call the
language model, and nothing from your Atlassian site is sent to it.** The "Parallax Architect"
agent that runs in Rovo uses Atlassian's own models, not this one.

## Third parties

The Parallax server runs on Fly.io. The Atlassian MCP endpoint and Forge platform are operated
by Atlassian under its own terms. No analytics or advertising services are used.

## Your choices

Uninstall the app at any time from Atlassian Administration. Delete any generated page, the
`Parallax Template: Service` page, or the labels `parallax`, `lain`, `machine-made` from your
site; nothing else is kept elsewhere.

## Contact

Open an issue at <https://github.com/spuentesp/parallax/issues>.
This statement lives at
<https://github.com/spuentesp/parallax/blob/main/docs/codegeist/privacy.md>; the source code of
the app and the server is at <https://github.com/spuentesp/parallax> under the MIT license.
