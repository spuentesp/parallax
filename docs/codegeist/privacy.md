# Privacy statement: Parallax for Atlassian

Last updated: 2026-11-24. This describes the `parallax-codegeist` Forge app and the Parallax
server it calls.

## What the app does with your data

| Data | What happens |
|---|---|
| **Confluence page titles, bodies and properties** | Read and written as the signed-in user, inside your site, to create Parallax pages and to read the Owner / Criticality / Runbook / Notes table. Page content is **not** sent to the Parallax server. |
| **Jira issues** | Not read by this version of the app. |
| **Tool inputs you type** | Workspace ids, search text, node ids and contract keys are sent to the Parallax server so it can look them up in its code graph. |
| **Atlassian account data** | Not sent to the Parallax server. |

## What leaves Atlassian

The app declares one outbound domain: `marbled-river-9619.fly.dev` (the Parallax server).
Requests carry only the tool inputs above and a read-only access token that identifies the app,
not you. Nothing else is sent.

## What is stored

- **In Atlassian / Forge:** the app uses no Forge storage. Pages and content properties it
  creates live in your Confluence site and are yours to edit or delete.
- **On the Parallax server:** the server indexes public demonstration repositories. It stores no
  information about your site or users. Its operational logs (default Fastify request logs) can
  contain request paths and query strings, so the search text you type can appear there.
  Logs are used for troubleshooting only.

## Third parties

The Parallax server runs on Fly.io. The Atlassian MCP endpoint and Forge platform are operated
by Atlassian under its own terms. No analytics or advertising services are used.

## Your choices

Uninstall the app at any time from Atlassian Administration. Delete any generated page, the
`Parallax Template: Service` page, or the labels `parallax`, `lain`, `machine-made` from your
site; nothing else is kept elsewhere.

## Contact

Open an issue at <https://github.com/spuentesp/parallax/issues>.
