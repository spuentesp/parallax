// Parallax Forge app: Rovo/MCP tools backed by the hosted Parallax + Lain graph.
//
// Every tool is a thin, read-only wrapper around a deterministic Parallax API
// endpoint. Rovo (or any MCP client) does the reasoning; Parallax supplies
// evidence from the real code graph. No second LLM is involved.
import api, { assumeTrustedRoute, fetch } from '@forge/api';
import { lookupAnnotations, publishServicePage } from './publisher.js';
import { expectedImpact as resolveExpectedImpact, toGraph } from './resolve.js';
import {
  assessmentMatchesPr,
  computeDrift,
  contactsFor,
  extractPrRefs,
  nextSteps,
  summarizeAssessment,
} from './review.js';

const BACKEND = 'https://marbled-river-9619.fly.dev';

// Confluence calls run as the invoking user, so Confluence enforces their permissions.
const cfAsUser = (path, init) => api.asUser().requestConfluence(assumeTrustedRoute(path), init);

// How many consumers get a Confluence lookup per blast-radius call (keeps latency bounded).
const MAX_ANNOTATION_LOOKUPS = 8;

// Forge function responses are size-limited, and agents read better from a
// compact answer. Cap the serialized JSON and say so when we truncate.
const MAX_CHARS = 18000;
const MAX_HITS = 15; // search results returned to the agent
const MAX_LINKS = 8; // endpoints listed per consumer
const MAX_SITES = 3; // sample call sites per consumer

function compact(data) {
  const text = JSON.stringify(data);
  if (text.length <= MAX_CHARS) return data;
  return {
    truncated: true,
    note: `Result was ${text.length} characters; showing the first ${MAX_CHARS}. Narrow the query for the rest.`,
    partialJson: text.slice(0, MAX_CHARS),
  };
}

// Call the Parallax API with the bearer token stored as an encrypted Forge variable.
async function parallax(path, query = {}) {
  const token = process.env.PARALLAX_TOKEN;
  if (!token) {
    return { error: 'PARALLAX_TOKEN is not configured for this app environment.' };
  }
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${BACKEND}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    return { error: `Parallax API answered HTTP ${res.status}`, path };
  }
  return res.json();
}

// Path segments come from agent input, so encode them.
const ws = (id) => `/api/workspaces/${encodeURIComponent(id)}`;

// Health check, no credentials required.
export async function parallaxStatus() {
  const res = await fetch(`${BACKEND}/api/health`);
  if (!res.ok) return { reachable: false, httpStatus: res.status };
  return { reachable: true, ...(await res.json()) };
}

// List the architecture workspaces (each is a set of repos analysed together).
export async function listWorkspaces() {
  const data = await parallax('/api/workspaces');
  if (data.error || !data.workspaces) return data;
  // Drop internal fields (engine URL, local paths) that an agent does not need.
  return compact({
    workspaces: data.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      repoCount: w.repoCount,
      repos: (w.repos || []).map((r) => ({ id: r.id, uri: r.uri, sha: r.sha })),
    })),
  });
}

// Structural overview of a workspace: what exists, the entry points, who uses what.
export async function briefing(payload) {
  const data = await parallax(`${ws(payload.workspaceId)}/map/briefing`);
  if (data.error) return data;
  if (!data.briefing) {
    return { error: `Workspace '${payload.workspaceId}' was not found or is not indexed yet.` };
  }
  return compact(data);
}

// Find services, symbols or contracts by name.
export async function findNodes(payload) {
  const data = await parallax(`${ws(payload.workspaceId)}/map/search`, { q: payload.query });
  if (data.error || !data.results) return data;
  const top = data.results.slice(0, MAX_HITS);
  return compact({
    total: data.results.length,
    shown: top.length,
    results: top.map((r) => ({
      nodeId: r.id,
      label: r.label,
      kind: r.kind,
      contract: r.contract,
      service: r.meta?.service,
      definedAt: r.meta?.definedAt,
      boundConsumers: r.meta?.boundConsumers,
    })),
  });
}

// Reduce one consumer/provider edge to what matters for impact analysis.
function summarizeEdge(entry) {
  const { peer, edge, links = [] } = entry;
  return {
    service: peer?.label,
    repo: peer?.meta?.repo,
    provenance: edge?.provenance, // deterministic = proven by code, inferred = heuristic
    confidence: edge?.confidence,
    usages: edge?.count,
    // The list is shortened to the busiest endpoints; the total says how many there really are.
    endpointsUsedTotal: links.length,
    endpointsUsed: links.slice(0, MAX_LINKS).map((l) => ({
      endpoint: l.endpoint?.label,
      usages: l.count,
    })),
    sampleCallSites: (edge?.sites || []).slice(0, MAX_SITES),
  };
}

// Load and summarize the blast radius of one node (not size-capped; callers cap).
async function loadNodeImpact(workspaceId, nodeId) {
  const data = await parallax(`${ws(workspaceId)}/map/node`, { id: nodeId });
  if (data.error) return data;
  // The API wraps the payload as { detail: {...} }; detail is null when the engine is unavailable.
  const d = data.detail;
  if (!d?.node) {
    return {
      error: `Node '${nodeId}' was not found in workspace '${workspaceId}'. Use parallax-find to get a valid nodeId.`,
    };
  }
  return {
    node: { nodeId: d.node.id, label: d.node.label, kind: d.node.kind, ...d.node.meta },
    endpointCount: d.endpointCount,
    consumers: (d.consumers || []).map(summarizeEdge),
    providers: (d.providers || []).map(summarizeEdge),
    groups: (d.children || []).map((c) => ({ nodeId: c.id, label: c.label, ...c.meta })),
  };
}

// Attach what people wrote on each consumer's Confluence page (owner, criticality, ...).
// Best effort: if Confluence is not connected or the user has not consented yet, the
// blast radius is still returned, just without annotations.
async function withAnnotations(impact) {
  const targets = impact.consumers.slice(0, MAX_ANNOTATION_LOOKUPS);
  try {
    const found = await Promise.all(targets.map((c) => lookupAnnotations(cfAsUser, c.service)));
    targets.forEach((c, i) => {
      if (!found[i]) return;
      c.confluencePage = found[i].pageUrl;
      if (found[i].annotations) c.annotations = found[i].annotations;
    });
    return impact;
  } catch {
    return {
      ...impact,
      annotationsUnavailable: 'Confluence annotations could not be read for this user.',
    };
  }
}

// Who consumes a node and what it depends on, with provenance. This is the blast radius.
export async function nodeImpact(payload) {
  const data = await loadNodeImpact(payload.workspaceId, payload.nodeId);
  return data.error ? data : compact(await withAnnotations(data));
}

// The longest ticket text we analyse; the rest is ignored.
const MAX_TEXT_CHARS = 8000;

// Limits that keep a ticket review answer small enough for a panel and for an agent.
const MAX_PRS_PER_TICKET = 3;
const MAX_TARGETS_IN_REVIEW = 6;
const MAX_CONSUMERS_IN_REVIEW = 6;

// Attach Confluence annotations (owner, criticality) to every distinct consumer of every
// target, with one lookup per service. Best effort, like withAnnotations.
async function annotateTargets(result) {
  const services = [...new Set(result.targets.flatMap((t) => t.consumers.map((c) => c.service)))];
  try {
    const found = await Promise.all(
      services.slice(0, MAX_ANNOTATION_LOOKUPS).map((s) => lookupAnnotations(cfAsUser, s)),
    );
    const bySvc = new Map(services.map((s, i) => [s, found[i]]));
    for (const t of result.targets) {
      for (const c of t.consumers) {
        const hit = bySvc.get(c.service);
        if (!hit) continue;
        c.confluencePage = hit.pageUrl;
        if (hit.annotations) c.annotations = hit.annotations;
      }
    }
  } catch {
    result.annotationsUnavailable = 'Confluence annotations could not be read for this user.';
  }
}

// Predict what a piece of text will touch (not size-capped; callers cap).
async function buildExpected(text, workspaceId) {
  const list = await parallax('/api/workspaces');
  if (list.error) return list;
  let workspaces = (list.workspaces || []).map((w) => ({ id: w.id, name: w.name }));
  if (workspaceId) workspaces = workspaces.filter((w) => w.id === workspaceId);

  const result = await resolveExpectedImpact({
    text: String(text ?? '').slice(0, MAX_TEXT_CHARS),
    workspaces,
    briefing: (id) => parallax(`${ws(id)}/map/briefing`),
    search: async (id, term) => (await findNodes({ workspaceId: id, query: term })).results ?? [],
    impact: loadNodeImpact,
  });
  await annotateTargets(result);
  // Rebuild the graph after annotations so owners and criticality are drawn.
  result.graph = toGraph(result.targets);
  return result;
}

// Predict what a piece of text (a Jira ticket) will touch, before any code exists.
export async function expectedImpact(payload) {
  const result = await buildExpected(payload.text, payload.workspaceId);
  return result.error ? result : compact(result);
}

// How many stored assessments are read when looking for a ticket's pull request.
const MAX_ASSESSMENTS_SCANNED = 8;
const FINAL_STATUSES = new Set(['READY', 'PARTIAL']);

// Find the newest stored assessment of one pull request.
// Returns { assessment } (final), { running: status } or { failed: true } or {} when none exists.
export async function findPrAssessment(ref) {
  const key = `${ref.owner}/${ref.repo}#${ref.number}`;
  const list = await parallax(`/api/assessments?pr=${encodeURIComponent(key)}`);
  if (list.error) return { error: list.error };
  const rows = list.assessments || [];

  // A server that knows the `pr` filter marks every row with its pull request. An older server
  // ignores the filter and returns everything without that mark: scan the newest reports then.
  const filtered = rows.every((a) => 'pr' in a);
  if (!filtered) return findPrAssessmentByScan(ref, rows);

  const mine = rows
    .filter((a) => a.pr && assessmentMatchesPr({ manifest: { pr: a.pr } }, ref))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const done = mine.find((a) => FINAL_STATUSES.has(a.status));
  if (done) {
    const full = await parallax(`/api/assessments/${done.id}`);
    return full.error ? { error: full.error } : { assessment: full.assessment };
  }
  const other = mine[0];
  if (!other) return {};
  return other.status === 'FAILED' ? { failed: true } : { running: other.status };
}

// Fallback for a server without the `pr` filter: open the newest reports and match their manifests.
async function findPrAssessmentByScan(ref, rows) {
  const recent = [...rows]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, MAX_ASSESSMENTS_SCANNED);
  const full = await Promise.all(recent.map((a) => parallax(`/api/assessments/${a.id}`)));
  const matches = full.map((r) => r.assessment).filter((a) => a && assessmentMatchesPr(a, ref));
  const done = matches.find((a) => FINAL_STATUSES.has(a.status));
  if (done) return { assessment: done };
  const other = matches[0];
  if (!other) return {};
  return other.status === 'FAILED' ? { failed: true } : { running: other.status };
}

// Everything a Jira ticket panel needs: the prediction from the ticket's words, the real
// analysis of any pull request the ticket links, and how the two differ.
export async function ticketReview(payload) {
  const text = String(payload.text ?? '').slice(0, MAX_TEXT_CHARS);
  const expected = await buildExpected(text, payload.workspaceId);
  if (expected.error) return expected;

  const pullRequests = [];
  for (const ref of extractPrRefs(text).slice(0, MAX_PRS_PER_TICKET)) {
    const found = await findPrAssessment(ref);
    if (found.error) {
      pullRequests.push({ url: ref.url, note: found.error });
    } else if (found.assessment) {
      const summary = summarizeAssessment(found.assessment);
      const drift = computeDrift(expected, summary);
      pullRequests.push({
        url: ref.url,
        assessment: summary,
        drift,
        nextSteps: nextSteps({ expected, drift, summary }),
      });
    } else if (found.running) {
      pullRequests.push({
        url: ref.url,
        note: `Analysis is ${found.running.toLowerCase()}; check back shortly.`,
      });
    } else {
      pullRequests.push({
        url: ref.url,
        note: found.failed
          ? 'The last analysis of this pull request failed. Re-run it from Parallax.'
          : 'This pull request has not been analysed yet.',
      });
    }
  }

  // Keep the answer small: the full per-target consumer lists are already summarised.
  return compact({
    expected: {
      summary: expected.summary,
      unmatchedTerms: expected.unmatchedTerms,
      targets: expected.targets.slice(0, MAX_TARGETS_IN_REVIEW).map((t) => ({
        workspaceId: t.workspaceId,
        matched: t.matched,
        node: { nodeId: t.node.nodeId, label: t.node.label, kind: t.node.kind },
        consumersTotal: t.consumersTotal,
        consumers: t.consumers.slice(0, MAX_CONSUMERS_IN_REVIEW).map((c) => ({
          service: c.service,
          provenance: c.provenance,
          usages: c.usages,
          annotations: c.annotations,
          confluencePage: c.confluencePage,
        })),
      })),
      graph: expected.graph,
    },
    // Who to talk to, and what to do next. With a linked PR the steps live on that PR; without
    // one they come from the prediction alone.
    contacts: contactsFor(expected),
    nextSteps: pullRequests.some((p) => p.nextSteps) ? undefined : nextSteps({ expected }),
    pullRequests,
  });
}

// Publish (create or update) a machine-generated Confluence page for one service.
export async function publishServiceDoc(payload) {
  const impact = await loadNodeImpact(payload.workspaceId, payload.nodeId);
  if (impact.error) return impact;
  if (impact.node.kind !== 'service') {
    return {
      error: `Node '${payload.nodeId}' is a ${impact.node.kind}, not a service. Pass a service node id such as svc:<name>.`,
    };
  }
  const list = await parallax('/api/workspaces');
  const workspace = (list.workspaces || []).find((w) => w.id === payload.workspaceId);
  try {
    return await publishServicePage({
      cf: cfAsUser,
      spaceKey: payload.spaceKey,
      impact,
      workspace,
      // The console is served at the server root; the router has no /app prefix
      // (a /app/... URL falls through to the default workspace).
      consoleBase: BACKEND,
    });
  } catch (e) {
    return { error: e.message };
  }
}

// Providers, schemas and consumers of one API contract (e.g. a GraphQL field or proto message).
export async function contractDetail(payload) {
  const query = { key: payload.contractKey };
  if (payload.service) query.service = payload.service;
  const data = await parallax(`${ws(payload.workspaceId)}/contracts/detail`, query);
  return data.error ? data : compact(data);
}
