# PR Evaluation — Pick an Open PR, or Automate It in CI

**Date:** 2026-10-20
**Status:** Draft for review. Defaults for the open questions are marked **[default]** and need confirmation before any GitHub write is implemented.
**Scope:** `packages/api` (GitHub adapters, assessment trigger, CI hook), `packages/web` (picker, workspace CI settings), `packages/shared` (contracts).

## Problem

PR evaluation today takes free-text `repo`, `base`, and `head` values. The user has to know the commits already, and nothing connects an assessment to a PR that is open on GitHub. The existing `GitHubAdapter` resolves a PR URL to its base and head SHAs, but it cannot list PRs and it has no token, so it works only for public repositories.

## Goals

1. **Pick an open PR.** From the org's workspace, the user sees the open PRs of the repos in scope and starts an assessment on one with a click. Base and head SHAs are resolved from GitHub, so the assessment identity stays a commit pair (§5).
2. **Automate.** A workspace can be configured so that every PR that opens or updates is assessed without a user action. The result is recorded in Parallax and reported back to the PR.

Both paths end in the same assessment pipeline. Nothing about the engine, the classification, or the coverage rules changes.

## Non-goals

- Commenting on PRs. Results go back as a commit status (see decision 2).
- Merge gating by default. A status can be made required by a repo admin, but Parallax never changes branch protection.
- Write access to repository contents.

## Design

### Read side: list and pick

- A new `GitHubPrLister` in `packages/api/src/github/` lists open PRs for a repo (`state=open`, paginated) and returns `PrSummary` items. It reuses the existing `PrSummary` shape.
- `GET /orgs/:orgId/prs` returns open PRs for every repo in the org's workspaces. Results are cached for a short TTL, so the picker doesn't call GitHub on every render.
- The picker is the primary entry in the assessment flow. The manual `repo/base/head` form stays as a fallback for local repos that have no remote.
- Private repos need a token. See decision 3.

### Write side: auto CI

- Each workspace has a `ci` setting: `off | on-open-and-update`, plus the target branch filter (default: any base branch).
- Triggers come from a GitHub webhook (`pull_request` events: `opened`, `synchronize`, `reopened`) delivered to `POST /webhooks/github`. The payload signature is verified with a shared secret before anything runs.
- Each event creates an assessment for `(base SHA, head SHA)`. Idempotency already comes from the `inputDigest` (§4), so redelivered webhooks don't duplicate work.
- The write component is separate from `GitHubAdapter`, which stays read-only. It lives in `packages/api/src/github/status-reporter.ts` and is the only code that holds a write-capable credential.

### Reporting back **[default: commit status]**

- When an assessment reaches `READY` or `PARTIAL`, the reporter sets a commit status on the head SHA with context `parallax/assessment`.
- State mapping, by the worst finding in the report:
  - any `Verified` finding → `failure`
  - otherwise any `NeedsInvestigation` finding → `pending`
  - all findings `NoKnownImpact` and coverage complete → `success`
  - status `PARTIAL` (incomplete coverage) → `pending`, with the coverage summary as the description. Coverage gaps never map to `success`.
- The status links back to the Parallax report URL.

### Contracts

- `shared`: `PrPickerItem`, `WorkspaceCiSettings`, `AssessmentTrigger` (`'manual' | 'picker' | 'webhook'`), recorded on the assessment so the UI can show where it came from.
- REST: `GET /orgs/:orgId/prs`, `GET/PUT /workspaces/:id/ci`, `POST /webhooks/github`.
- MCP: `parallax_assess_pr` keeps accepting `prUrl`; it doesn't need the picker.

### UI

- Assessment entry point: a list of open PRs grouped by repo, each with title, author, base → head, and changed-file count. Selecting one starts the assessment and navigates to it.
- Workspace page: a CI section with the on/off setting, the branch filter, and the last webhook delivery status.
- Assessment list shows the trigger (manual, picker, webhook) for each row.

## Decisions needed

1. **Scope of the picker and CI** — confirmed: both paths.
2. **Reporting back** — **[default]** commit status on the head SHA, no comments. Alternative: comments, which are noisier and need more permissions.
3. **Token scopes** — **[default]** two credentials, never one:
   - Read credential (`GitHubPrLister`, `GitHubAdapter`): fine-grained token with *Pull requests: read* and *Contents: read* on the org's repos.
   - Write credential (`status-reporter`): fine-grained token with *Commit statuses: write* only, used by nothing else.
   Both are stored as secrets in the api config, never in the database, and never logged.

## Security notes

- Webhook payloads are verified with HMAC-SHA256 against a per-workspace secret before parsing. Unsigned or stale deliveries are rejected.
- The write credential is only ever read by `status-reporter`. A test should fail if any other module imports it.
- Webhook-triggered assessments of fork PRs are off by default. A fork's head SHA can point at code the org hasn't reviewed.

## Testing

- Read side: fixture responses for the GitHub pulls API at the network edge (MSW-style interception, no internal mocks).
- Webhook: signed and unsigned payloads, a redelivered payload (no second assessment), and an event for an unconfigured repo (ignored).
- Status mapping: one test per row of the state table above, including `PARTIAL` never mapping to `success`.
- Picker in the web app: list rendering, selection navigates to the new assessment, and an empty org shows the manual fallback.

## Open items after this spec

- Whether to support GitHub Enterprise hosts (out of scope for now).
- Whether comments on PRs become a per-workspace option later.
