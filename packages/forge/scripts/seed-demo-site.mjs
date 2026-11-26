#!/usr/bin/env node
// Seeds the Codegeist demo Atlassian site with Jira tickets that name real
// services and endpoints from the Parallax demo clusters (OpenShell, NemoClaw,
// NeMo-Fabric, NeMo Agent Toolkit). Safe to re-run: existing tickets are skipped.
//
//   ATL_SITE=https://<site>.atlassian.net ATL_EMAIL=... ATL_TOKEN=... \
//     node packages/forge/scripts/seed-demo-site.mjs
//
// The Jira project (default key OSP) must already exist.

const { ATL_SITE, ATL_EMAIL, ATL_TOKEN } = process.env;
const PROJECT = process.env.ATL_PROJECT ?? 'OSP';
if (!ATL_SITE || !ATL_EMAIL || !ATL_TOKEN) {
  console.error('Set ATL_SITE, ATL_EMAIL and ATL_TOKEN.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${ATL_EMAIL}:${ATL_TOKEN}`).toString('base64')}`;
const call = async (method, path, body) => {
  const res = await fetch(`${ATL_SITE}${path}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

// Atlassian Document Format: one paragraph per string.
const adf = (...paragraphs) => ({
  type: 'doc',
  version: 1,
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});

// `type` is an issue-type name in the project. Descriptions deliberately mention
// exact service and endpoint names so Parallax can resolve them in the graph.
const TICKETS = [
  {
    type: 'Epic',
    summary: 'Sandbox lifecycle API v2',
    body: ['Umbrella for the next iteration of the sandbox lifecycle API exposed by openshell-gateway.'],
  },
  {
    type: 'Story',
    summary: 'Remove the labels map from the CreateSandbox request',
    // This ticket used to say "add" a labels map, which already exists in the real repository.
    renamedFrom: 'Add a labels map to the CreateSandbox request',
    body: [
      'Labels will be set after creation instead. Remove the labels map from rpc openshell.v1.OpenShell/CreateSandbox in the openshell-gateway service.',
      'Open question: who calls CreateSandbox today, and do we have to coordinate a client release?',
    ],
    // A clearly labelled synthetic PR on a fork that makes exactly this breaking change.
    pr: 'https://github.com/spuentesp/openshell/pull/1',
  },
  {
    type: 'Task',
    summary: 'Remove the ListSandboxTemplates RPC',
    body: [
      'Sandbox templates are being managed through config instead. Remove rpc openshell.v1.OpenShell/ListSandboxTemplates from the openshell-gateway service.',
      'Open question: which clients still call it?',
    ],
    // A clearly labelled synthetic PR on a fork that removes exactly this RPC.
    pr: 'https://github.com/spuentesp/openshell/pull/2',
  },
  {
    type: 'Task',
    summary: 'Change the ListSandboxes default page size from 50 to 25',
    body: [
      'rpc openshell.v1.OpenShell/ListSandboxes on openshell-gateway returns up to 50 sandboxes by default. Halve the default to reduce latency.',
      'Callers that rely on the default page size need to be identified before we ship.',
    ],
  },
  {
    type: 'Bug',
    summary: 'GetProviderProfile returns stale data after UpdateConfig',
    body: [
      'After rpc openshell.v1.OpenShell/UpdateConfig, rpc openshell.v1.OpenShell/GetProviderProfile can return the previous profile for a few seconds.',
      'The nemoclaw service reads provider profiles through its OpenShell adapter, so this may surface as flaky provider setup there.',
    ],
    // A real, merged NemoClaw PR that edits the OpenShell adapter (code-only: no contract change).
    pr: 'https://github.com/NVIDIA/NemoClaw/pull/13812',
  },
  {
    type: 'Story',
    summary: "Keep pool sandbox sessions on their supervisor's gateway",
    body: [
      'Pool sandbox sessions should stay on the gateway of their supervisor. We expect to change rpc openshell.v1.OpenShell/ConnectSupervisor in the openshell-gateway service.',
    ],
    // A real, merged OpenShell PR that changes gateway contracts (it touches more than the ticket names).
    pr: 'https://github.com/NVIDIA/OpenShell/pull/5052',
  },
  {
    type: 'Task',
    summary: 'Replace the credential field in ComputeDriver AuthenticateSandbox',
    body: [
      'rpc openshell.compute.v1.ComputeDriver/AuthenticateSandbox takes a string credential. Replace it with a structured token message.',
      'Internal driver contract on openshell-gateway; we believe nothing outside the gateway calls it.',
    ],
  },
  {
    type: 'Story',
    summary: 'Support streaming responses on POST /v1/chat/completions in nemo-fabric',
    body: [
      'Add server-sent-event streaming to http POST /v1/chat/completions served by the nemo-fabric service.',
      'nemoclaw is the main caller; confirm how it consumes the response before changing the wire format.',
    ],
  },
  {
    type: 'Task',
    summary: 'Drop the owned_by field from GET /v1/models',
    body: [
      'Remove the deprecated owned_by field from the http GET /v1/models response in nemo-fabric.',
      'Check whether any consumer reads it.',
    ],
  },
  {
    type: 'Task',
    summary: 'Route the NeMo Agent Toolkit UI chat through a streaming proxy endpoint',
    body: [
      'The nat-ui service proxies chat to the nat service. Add a streaming route on nat and point nat-ui at it.',
      'This work lives in the NeMo Agent Toolkit cluster, separate from the OpenShell stack.',
    ],
  },
];

const types = await call('GET', `/rest/api/3/issue/createmeta/${PROJECT}/issuetypes`);
const typeId = Object.fromEntries((types.issueTypes ?? types.values ?? []).map((t) => [t.name, t.id]));

const existing = await call(
  'POST',
  '/rest/api/3/search/jql',
  { jql: `project = ${PROJECT}`, fields: ['summary', 'description'], maxResults: 100 },
);
const have = new Map((existing.issues ?? []).map((i) => [i.fields.summary, i]));

// Plain text of an Atlassian Document Format value (enough to look for a URL).
const adfText = (node) =>
  !node ? '' : node.text ?? (node.content ?? []).map(adfText).join(' ');

// The description for a ticket: its body, plus the pull request it links when there is one.
const describe = (t) => adf(...t.body, ...(t.pr ? [`Pull request: ${t.pr}`] : []));

let epicKey;
for (const t of TICKETS) {
  // A ticket that was reworded: bring the existing issue up to date instead of creating a twin.
  const old = t.renamedFrom && !have.has(t.summary) ? have.get(t.renamedFrom) : undefined;
  if (old) {
    await call('PUT', `/rest/api/3/issue/${old.key}`, {
      fields: { summary: t.summary, description: describe(t) },
    });
    console.log(`rename ${old.key}  -> ${t.summary}`);
    continue;
  }
  const found = have.get(t.summary);
  if (found) {
    // Idempotent update: add the pull request link to a ticket that exists without it.
    if (t.pr && !adfText(found.fields.description).includes(t.pr)) {
      await call('PUT', `/rest/api/3/issue/${found.key}`, { fields: { description: describe(t) } });
      console.log(`update ${found.key}  linked ${t.pr}`);
    } else {
      console.log(`skip   ${t.summary}`);
    }
    continue;
  }
  const fields = {
    project: { key: PROJECT },
    issuetype: { id: typeId[t.type] },
    summary: t.summary,
    description: describe(t),
    labels: ['parallax-demo'],
  };
  if (t.type !== 'Epic' && epicKey && /CreateSandbox|ListSandboxes/.test(t.summary)) {
    fields.parent = { key: epicKey };
  }
  const made = await call('POST', '/rest/api/3/issue', { fields });
  if (t.type === 'Epic') epicKey = made.key;
  console.log(`create ${made.key}  ${t.type.padEnd(5)} ${t.summary}`);
}
