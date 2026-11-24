// Turns free text (a Jira ticket) into the part of the architecture it is likely to touch.
//
// Pure orchestration: the caller injects the functions that talk to Parallax, so the logic
// can be tested without a network.
//   briefing(workspaceId)        -> { repos: [{ services: [{ id, name }] }] }  (service names)
//   search(workspaceId, term)    -> [{ nodeId, label, kind, service, boundConsumers }]
//   impact(workspaceId, nodeId)  -> { node, consumers: [...] } or { error }
//
// "Expected impact" is a prediction made from words, before any code exists. Every target
// says how it was matched (exact or fuzzy) so a reader can judge how much to trust it.

const MAX_TERMS = 10;
const MAX_TARGETS = 8;
const MAX_CONSUMERS_PER_TARGET = 12;
const MAX_HITS_PER_TERM = 3;
const MIN_SERVICE_NAME_LENGTH = 4; // shorter names ("nat") match too many ordinary words

// Identifiers worth looking up. Order matters: more specific patterns first.
const PATTERNS = [
  // Full contract keys such as rpc:openshell.v1.OpenShell/CreateSandbox -> the method name.
  { re: /\brpc:[\w.]+\/(\w+)/g, pick: (m) => m[1] },
  // HTTP routes such as "POST /v1/chat/completions". The method is kept so that GET and
  // POST on the same path are not confused.
  { re: /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-./{}:]+)/g, pick: (m) => `${m[1]} ${m[2]}` },
  // CamelCase identifiers with at least two humps: CreateSandbox, GetProviderProfile.
  { re: /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g, pick: (m) => m[0] },
  // kebab-case names: openshell-gateway, nemo-fabric.
  { re: /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g, pick: (m) => m[0] },
];

// Words that look like identifiers but are not architecture. Kept short on purpose.
const STOPWORDS = new Set(['e2e-test', 'follow-up', 'work-in-progress', 'built-in', 'read-only']);

// Extract identifier-like terms from free text, most specific first, without duplicates.
export function extractTerms(text) {
  const seen = new Set();
  const terms = [];
  for (const { re, pick } of PATTERNS) {
    for (const m of String(text ?? '').matchAll(re)) {
      const term = pick(m);
      const key = term.toLowerCase();
      if (term.length < 3 || STOPWORDS.has(key) || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= MAX_TERMS) return terms;
    }
  }
  return terms;
}

// Whole-word, case-insensitive search for known service names inside the text.
export function matchServiceNames(text, serviceNames) {
  const found = [];
  for (const name of serviceNames) {
    if (name.length < MIN_SERVICE_NAME_LENGTH) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)) found.push(name);
  }
  return found;
}

const ROUTE_TERM = /^(?:GET|POST|PUT|PATCH|DELETE) /;

// What to type into the graph search for a term: a route is searched by its path alone.
export const searchText = (term) => (ROUTE_TERM.test(term) ? term.split(' ').pop() : term);

// Does this search hit name the term exactly (not merely contain it)?
function isExact(hit, term) {
  const label = String(hit.label ?? '').toLowerCase();
  const wanted = term.toLowerCase();
  if (ROUTE_TERM.test(term)) {
    // Route labels look like "http:POST /v1/x": the method and path must both match.
    const at = label.length - wanted.length;
    return at >= 0 && label.endsWith(wanted) && (at === 0 || ' :'.includes(label[at - 1]));
  }
  return label.split('/').pop() === wanted;
}

// Pick the hits worth following for one term: exact ones if any, else a couple of fuzzy ones.
function chooseHits(hits, term) {
  const usable = hits.filter((h) => h.kind === 'endpoint' || h.kind === 'service');
  const exact = usable.filter((h) => isExact(h, term));
  if (exact.length) return exact.slice(0, MAX_HITS_PER_TERM).map((hit) => ({ hit, exact: true }));
  return usable.slice(0, 2).map((hit) => ({ hit, exact: false }));
}

// Build the expected-impact answer for a piece of text.
export async function expectedImpact({ text, workspaces, briefing, search, impact }) {
  const terms = extractTerms(text);
  const targets = [];
  const seenNodes = new Set();
  const matchedTerms = new Set();

  for (const ws of workspaces) {
    // Service names known in this workspace, matched as whole words.
    let serviceNames = [];
    try {
      const b = await briefing(ws.id);
      serviceNames = (b?.briefing?.repos ?? []).flatMap((r) => r.services.map((s) => s.name));
    } catch {
      // A workspace whose briefing fails is skipped for name matching; term search still runs.
    }
    const serviceHits = matchServiceNames(String(text ?? ''), serviceNames).map((name) => ({
      term: name,
      hit: { nodeId: `svc:${name}`, label: name, kind: 'service' },
      exact: true,
    }));

    const termHits = [];
    for (const term of terms) {
      const hits = await search(ws.id, searchText(term));
      for (const chosen of chooseHits(hits, term)) termHits.push({ term, ...chosen });
    }

    // Exact matches win. A loose hit is only worth showing when nothing matched exactly;
    // otherwise it is noise (a hit for "ComputeDriver" must not displace the exact one).
    const all = [...serviceHits, ...termHits];
    const candidates = all.some((c) => c.exact) ? all.filter((c) => c.exact) : all;

    for (const cand of candidates) {
      const id = `${ws.id}|${cand.hit.nodeId}`;
      if (seenNodes.has(id) || targets.length >= MAX_TARGETS) continue;
      seenNodes.add(id);
      matchedTerms.add(cand.term.toLowerCase());
      targets.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        term: cand.term,
        exact: cand.exact,
        hit: cand.hit,
      });
    }
  }

  // Resolve each target's consumers from the graph.
  const resolved = [];
  for (const t of targets) {
    const detail = await impact(t.workspaceId, t.hit.nodeId);
    if (!detail || detail.error) continue;
    resolved.push({
      workspaceId: t.workspaceId,
      workspaceName: t.workspaceName,
      term: t.term,
      matched: t.exact ? 'exact' : 'fuzzy',
      node: detail.node,
      consumers: detail.consumers.slice(0, MAX_CONSUMERS_PER_TARGET),
      consumersTotal: detail.consumers.length,
    });
  }

  // The most precise answers first: a named endpoint, then a whole service; within each,
  // the ones with the most consumers.
  const rank = (t) => ({ endpoint: 0, service: 1 })[t.node.kind] ?? 2;
  resolved.sort((a, b) => rank(a) - rank(b) || b.consumersTotal - a.consumersTotal);

  return {
    terms,
    unmatchedTerms: terms.filter((t) => !matchedTerms.has(t.toLowerCase())),
    targets: resolved,
    summary: summarize(resolved),
    graph: toGraph(resolved),
  };
}

// Counts the reader sees first: how many things, how many consumers, how sure we are.
function summarize(resolved) {
  const consumers = new Map();
  for (const t of resolved) {
    for (const c of t.consumers) {
      const prev = consumers.get(c.service);
      const proven = c.provenance === 'deterministic';
      consumers.set(c.service, { proven: (prev?.proven ?? false) || proven });
    }
  }
  const all = [...consumers.values()];
  return {
    targets: resolved.length,
    consumers: all.length,
    provenByCode: all.filter((c) => c.proven).length,
    inferredOnly: all.filter((c) => !c.proven).length,
  };
}

// Nodes and edges for drawing: targets in the middle, consumers pointing at them.
export function toGraph(resolved) {
  const nodes = new Map();
  const edges = [];
  for (const t of resolved) {
    const targetId = `target:${t.workspaceId}:${t.node.nodeId}`;
    nodes.set(targetId, { id: targetId, label: t.node.label, kind: 'target', detail: t.node.kind });
    for (const c of t.consumers) {
      const consumerId = `service:${t.workspaceId}:${c.service}`;
      if (!nodes.has(consumerId)) {
        nodes.set(consumerId, {
          id: consumerId,
          label: c.service,
          kind: 'consumer',
          detail: c.annotations?.owner ?? null,
          criticality: c.annotations?.criticality ?? null,
        });
      }
      edges.push({ from: consumerId, to: targetId, provenance: c.provenance, usages: c.usages });
    }
  }
  return { nodes: [...nodes.values()], edges };
}
