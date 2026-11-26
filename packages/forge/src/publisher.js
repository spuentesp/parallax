// Publishes machine-generated architecture pages to Confluence and reads human
// annotations back from them.
//
// Free of Forge imports so it can be tested: the caller injects `cf(path, init)`,
// a function that performs a Confluence REST request and returns a fetch-style
// Response. In production that is api.asUser().requestConfluence.
//
// Two-way model:
//  - Machine part  : everything above the "Human notes" heading. Rewritten on every run.
//  - Human part    : the "Human notes" heading and everything below it. Never rewritten.
//  - Read-back     : the Owner / Criticality / Runbook / Notes table in the human part is
//                    parsed by lookupAnnotations() and returned alongside blast-radius data.
//
// Safety rules:
//  - A page is only UPDATED if it carries our marker property. A same-titled page that
//    we did not create is never touched.
//  - The page layout comes from a template page in the same space. If it is missing it
//    is created from the built-in default; if a human edited it, their version is used.

export const MARKER_KEY = 'parallax-generated';
export const TEMPLATE_MARKER_KEY = 'parallax-template';
export const TEMPLATE_TITLE = 'Parallax Template: Service';
export const HUMAN_HEADING = 'Human notes';
export const LABELS = ['parallax', 'lain', 'machine-made'];
export const ANNOTATION_FIELDS = ['Owner', 'Criticality', 'Runbook', 'Notes'];

// Escape text before placing it in Confluence storage-format XHTML.
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A coloured status lozenge, used as a visible "machine made" tag.
const lozenge = (title, colour) =>
  `<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">${esc(title)}</ac:parameter><ac:parameter ac:name="colour">${colour}</ac:parameter></ac:structured-macro>`;

const row = (cells, header = false) => {
  const tag = header ? 'th' : 'td';
  return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
};
const table = (head, rows) =>
  `<table><tbody>${row(head, true)}${rows.map((r) => row(r)).join('')}</tbody></table>`;

// Human wording for the evidence label coming from the graph.
const evidence = (provenance) =>
  provenance === 'deterministic'
    ? 'Proven by code'
    : `Inferred (${esc(provenance ?? 'unknown')}), verify before relying on it`;

export const pageTitle = (label) => `Service architecture: ${label}`;

// When the endpoint list was shortened, say how many more there are.
const moreItem = (c) => {
  const hidden = (c.endpointsUsedTotal ?? c.endpointsUsed.length) - c.endpointsUsed.length;
  return hidden > 0 ? `<li>and ${hidden} more</li>` : '';
};

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

// Tokens are replaced with generated fragments. Everything from the "Human notes"
// heading down is the human part.
export const DEFAULT_TEMPLATE = [
  '{{banner}}',
  '<h2>Overview</h2>',
  '{{overview}}',
  '<h2>Who depends on this service</h2>',
  '{{consumers}}',
  '{{providers}}',
  '<h2>Contract groups</h2>',
  '{{groups}}',
  '<h2>Evidence</h2>',
  '{{evidence}}',
  '<h2>Links</h2>',
  '{{links}}',
  `<h2>${HUMAN_HEADING}</h2>`,
  '<p>Everything from this heading down belongs to people: Parallax never overwrites it. Fill in the table so blast-radius answers can name an owner.</p>',
  '{{annotations}}',
].join('\n');

// Replace {{token}} placeholders. A token that Confluence wrapped in its own paragraph
// is replaced together with the paragraph, so block elements stay valid.
export function renderTemplate(template, fragments) {
  const lookup = (name) => fragments[name] ?? '';
  return template
    .replace(/<p[^>]*>\s*\{\{\s*(\w+)\s*\}\}\s*<\/p>/g, (_, name) => lookup(name))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => lookup(name));
}

const HUMAN_HEADING_RE = new RegExp(`<h2[^>]*>\\s*${HUMAN_HEADING}\\s*</h2>`, 'i');

// Split a page body at the human heading. `human` is '' when there is no such heading.
export function splitHuman(body) {
  const at = body.search(HUMAN_HEADING_RE);
  if (at < 0) return { machine: body, human: '' };
  return { machine: body.slice(0, at), human: body.slice(at) };
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

// The empty annotations table people fill in. Placeholders in parentheses are ignored on read-back.
function annotationsScaffold() {
  const rows = ANNOTATION_FIELDS.map(
    (f) => `<tr><th>${f}</th><td>(add ${f.toLowerCase()})</td></tr>`,
  ).join('');
  return `<ac:structured-macro ac:name="details"><ac:rich-text-body><table><tbody>${rows}</tbody></table></ac:rich-text-body></ac:structured-macro>`;
}

const attr = (url) => esc(url);

export function buildFragments({ impact, workspace, generatedAt, links }) {
  const { node, consumers, providers, groups } = impact;
  const repo = (workspace?.repos ?? []).find((r) => r.id === node.repo);

  const consumerRows = consumers.map((c) => [
    `<strong>${esc(c.service)}</strong>`,
    esc(c.repo),
    evidence(c.provenance),
    esc(c.usages),
    c.endpointsUsed.length
      ? `<ul>${c.endpointsUsed.map((e) => `<li><code>${esc(e.endpoint)}</code> (${esc(e.usages)})</li>`).join('')}${moreItem(c)}</ul>`
      : '-',
    c.sampleCallSites.length
      ? `<ul>${c.sampleCallSites.map((s) => `<li><code>${esc(s.repo)}:${esc(s.path)}:${esc(s.line)}</code></li>`).join('')}</ul>`
      : '-',
  ]);

  const linkItems = [];
  if (links?.console)
    linkItems.push(`<li><a href="${attr(links.console)}">Open this service in Parallax</a></li>`);
  if (links?.jira)
    linkItems.push(
      `<li><a href="${attr(links.jira)}">Jira tickets mentioning ${esc(node.label)}</a></li>`,
    );

  return {
    banner:
      `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>${lozenge('MACHINE MADE', 'Purple')} ${lozenge('PARALLAX', 'Blue')} ${lozenge('LAIN', 'Grey')}</p>` +
      `<p>The part of this page above "${HUMAN_HEADING}" was generated automatically by Parallax from the Lain code graph and is overwritten on every run. Edit only below the "${HUMAN_HEADING}" heading.</p></ac:rich-text-body></ac:structured-macro>`,
    overview: table(
      ['Service', 'Repository', 'Endpoints', 'Consumer services'],
      [
        [
          `<strong>${esc(node.label)}</strong>`,
          esc(node.repo),
          esc(impact.endpointCount ?? node.endpoints),
          esc(consumers.length),
        ],
      ],
    ),
    consumers: consumers.length
      ? table(
          ['Consumer', 'Repository', 'Evidence', 'Usages', 'Endpoints used', 'Sample call sites'],
          consumerRows,
        )
      : '<p>No consumer was found in the analysed repositories.</p>',
    providers: providers.length
      ? `<h2>What this service depends on</h2>${table(
          ['Provider', 'Repository', 'Evidence', 'Usages'],
          providers.map((p) => [
            esc(p.service),
            esc(p.repo),
            evidence(p.provenance),
            esc(p.usages),
          ]),
        )}`
      : '',
    groups: groups.length
      ? table(
          ['Group', 'Kind', 'Contracts'],
          groups.map((g) => [
            esc(g.label),
            esc(g.contractKind ?? g.group ?? ''),
            esc(g.contracts ?? ''),
          ]),
        )
      : '<p>No contract groups reported.</p>',
    evidence: table(
      ['Workspace', 'Repository commit', 'Generated at', 'Generated by'],
      [
        [
          esc(workspace?.name ?? workspace?.id ?? ''),
          repo ? `<code>${esc(repo.id)}@${esc(repo.sha)}</code>` : 'unknown',
          esc(generatedAt),
          'Parallax (powered by Lain)',
        ],
      ],
    ),
    links: linkItems.length ? `<ul>${linkItems.join('')}</ul>` : '<p>No links available.</p>',
    annotations: annotationsScaffold(),
  };
}

// ---------------------------------------------------------------------------
// Read-back
// ---------------------------------------------------------------------------

const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// Read the Owner / Criticality / Runbook / Notes table from a page body.
// Empty cells and "(add ...)" placeholders are ignored. Returns null when nothing is filled in.
export function parseAnnotations(storage) {
  const macro = storage.match(
    /<ac:structured-macro[^>]*ac:name="details"[^>]*>([\s\S]*?)<\/ac:structured-macro>/,
  );
  if (!macro) return null;
  const out = {};
  for (const m of macro[1].matchAll(
    /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
  )) {
    const key = stripTags(m[1]).toLowerCase();
    const value = stripTags(m[2]);
    if (!ANNOTATION_FIELDS.some((f) => f.toLowerCase() === key)) continue;
    if (!value || /^\(.*\)$/.test(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Confluence I/O
// ---------------------------------------------------------------------------

const json = { 'Content-Type': 'application/json', Accept: 'application/json' };

async function mustOk(res, what) {
  if (res.ok) return res;
  const detail = (await res.text()).slice(0, 300);
  const err = new Error(`${what} failed: HTTP ${res.status} ${detail}`);
  err.status = res.status;
  throw err;
}

// Find the human-written annotations for a service from its Confluence page, if any.
// Returns { pageUrl, annotations } or null when there is no page. Never throws for a missing page.
export async function lookupAnnotations(cf, label) {
  const res = await cf(
    `/wiki/api/v2/pages?title=${encodeURIComponent(pageTitle(label))}&body-format=storage&limit=5`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const page = data.results?.[0];
  if (!page) return null;
  const pageUrl = page._links?.webui ? `${data._links?.base ?? ''}${page._links.webui}` : null;
  return { pageUrl, annotations: parseAnnotations(page.body?.storage?.value ?? '') };
}

// Return the template body for a space, creating the default template page if there is none.
async function loadTemplate(cf, space) {
  const found = await mustOk(
    await cf(
      `/wiki/api/v2/spaces/${space.id}/pages?title=${encodeURIComponent(TEMPLATE_TITLE)}&body-format=storage&limit=5`,
    ),
    'Template lookup',
  );
  const existing = (await found.json()).results?.[0];
  if (existing)
    return {
      body: existing.body?.storage?.value || DEFAULT_TEMPLATE,
      created: false,
      pageId: existing.id,
    };

  const created = await (
    await mustOk(
      await cf('/wiki/api/v2/pages', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          spaceId: space.id,
          status: 'current',
          title: TEMPLATE_TITLE,
          body: { representation: 'storage', value: DEFAULT_TEMPLATE },
        }),
      }),
      'Template create',
    )
  ).json();
  await mustOk(
    await cf(`/wiki/api/v2/pages/${created.id}/properties`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ key: TEMPLATE_MARKER_KEY, value: { generator: 'parallax' } }),
    }),
    'Template marker write',
  );
  return { body: DEFAULT_TEMPLATE, created: true, pageId: created.id };
}

// Create or update the service page. Returns { action, pageId, title, webui, ... }.
export async function publishServicePage({
  cf,
  spaceKey,
  impact,
  workspace,
  consoleBase,
  now = new Date(),
}) {
  const spaces = await mustOk(
    await cf(`/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`),
    'Space lookup',
  );
  const spacesData = await spaces.json();
  const space = spacesData.results?.[0];
  if (!space) return { error: `No Confluence space with key '${spaceKey}'.` };

  // The Confluence base URL ends with /wiki; the Jira site is its parent.
  const siteUrl = (spacesData._links?.base ?? '').replace(/\/wiki\/?$/, '');
  const label = impact.node.label;
  const links = {
    console: consoleBase
      ? `${consoleBase}/orgs/${encodeURIComponent(workspace?.id ?? '')}/services/${encodeURIComponent(impact.node.nodeId.replace(/^svc:/, ''))}`
      : null,
    jira: siteUrl
      ? `${siteUrl}/issues/?jql=${encodeURIComponent(`text ~ "${label}" ORDER BY updated DESC`)}`
      : null,
  };

  const template = await loadTemplate(cf, space);
  const rendered = renderTemplate(
    template.body,
    buildFragments({ impact, workspace, generatedAt: now.toISOString(), links }),
  );
  const title = pageTitle(label);

  const found = await mustOk(
    await cf(`/wiki/api/v2/spaces/${space.id}/pages?title=${encodeURIComponent(title)}&limit=5`),
    'Page lookup',
  );
  const existing = (await found.json()).results?.[0];

  let pageId;
  let action;
  let webui;
  if (existing) {
    // Only touch pages we created: they carry the marker property.
    const props = await mustOk(
      await cf(`/wiki/api/v2/pages/${existing.id}/properties?key=${MARKER_KEY}`),
      'Marker lookup',
    );
    if (!(await props.json()).results?.length) {
      return {
        error: `A page titled '${title}' already exists in '${spaceKey}' but was not generated by Parallax. Refusing to overwrite it.`,
        pageId: existing.id,
      };
    }
    const current = await (
      await mustOk(await cf(`/wiki/api/v2/pages/${existing.id}?body-format=storage`), 'Page read')
    ).json();
    // Regenerate the machine part, keep the human part exactly as people left it.
    const fresh = splitHuman(rendered);
    const keptHuman = splitHuman(current.body?.storage?.value ?? '').human;
    const body = fresh.machine + (keptHuman || fresh.human);
    const updated = await mustOk(
      await cf(`/wiki/api/v2/pages/${existing.id}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({
          id: existing.id,
          status: 'current',
          title,
          body: { representation: 'storage', value: body },
          version: { number: current.version.number + 1, message: 'Regenerated by Parallax' },
        }),
      }),
      'Page update',
    );
    const page = await updated.json();
    pageId = page.id;
    webui = page._links?.webui;
    action = 'updated';
  } else {
    const created = await mustOk(
      await cf('/wiki/api/v2/pages', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          spaceId: space.id,
          status: 'current',
          title,
          body: { representation: 'storage', value: rendered },
        }),
      }),
      'Page create',
    );
    const page = await created.json();
    pageId = page.id;
    webui = page._links?.webui;
    action = 'created';
    // Mark the page as ours so later runs may update it.
    await mustOk(
      await cf(`/wiki/api/v2/pages/${pageId}/properties`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          key: MARKER_KEY,
          value: { generator: 'parallax', node: impact.node.nodeId, workspace: workspace?.id },
        }),
      }),
      'Marker write',
    );
  }

  // Labels are idempotent: re-adding an existing label is harmless.
  await mustOk(
    await cf(`/wiki/rest/api/content/${pageId}/label`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify(LABELS.map((name) => ({ prefix: 'global', name }))),
    }),
    'Label write',
  );

  return {
    action,
    pageId,
    title,
    space: spaceKey,
    webui,
    labels: LABELS,
    templateCreated: template.created,
    links,
  };
}
