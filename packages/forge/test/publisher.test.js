// Tests for the Confluence publisher. Confluence itself is replaced at the process
// edge by an in-memory fake of the REST endpoints the publisher calls; no internal
// module is mocked.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildFragments,
  DEFAULT_TEMPLATE,
  esc,
  lookupAnnotations,
  MARKER_KEY,
  pageTitle,
  parseAnnotations,
  publishServicePage,
  renderTemplate,
  splitHuman,
  TEMPLATE_MARKER_KEY,
  TEMPLATE_TITLE,
} from '../src/publisher.js';

const BASE = 'https://demo.atlassian.net';

// In-memory Confluence: spaces, pages with versions, content properties and labels.
function fakeConfluence() {
  const spaces = [{ id: '10', key: 'DOCS' }];
  const pages = new Map();
  const props = new Map();
  const labels = new Map();
  let nextId = 100;

  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const view = (p, withBody) => ({
    id: p.id,
    title: p.title,
    spaceId: p.spaceId,
    status: 'current',
    version: { number: p.version },
    ...(withBody ? { body: { storage: { value: p.body } } } : {}),
    _links: { webui: `/spaces/DOCS/pages/${p.id}/${encodeURIComponent(p.title)}` },
  });

  async function cf(path, init = {}) {
    const url = new URL(path, BASE);
    const method = init.method ?? 'GET';
    const q = url.searchParams;
    const withBody = q.get('body-format') === 'storage';
    const p = url.pathname;
    // Which resource the path addresses; each regex captures the numeric id.
    const spacePages = p.match(/^\/wiki\/api\/v2\/spaces\/(\d+)\/pages$/);
    const pageProps = p.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/properties$/);
    const onePage = p.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/);
    const pageLabels = p.match(/^\/wiki\/rest\/api\/content\/(\d+)\/label$/);

    if (method === 'GET' && p === '/wiki/api/v2/spaces') {
      return reply(200, {
        results: spaces.filter((s) => s.key === q.get('keys')),
        _links: { base: `${BASE}/wiki` },
      });
    }
    if (method === 'GET' && spacePages) {
      const found = [...pages.values()].filter(
        (x) => x.spaceId === spacePages[1] && x.title === q.get('title'),
      );
      return reply(200, { results: found.map((x) => view(x, withBody)) });
    }
    if (method === 'GET' && p === '/wiki/api/v2/pages') {
      const found = [...pages.values()].filter((x) => x.title === q.get('title'));
      return reply(200, {
        results: found.map((x) => view(x, withBody)),
        _links: { base: `${BASE}/wiki` },
      });
    }
    if (method === 'POST' && p === '/wiki/api/v2/pages') {
      const b = JSON.parse(init.body);
      const id = String(nextId++);
      pages.set(id, { id, title: b.title, spaceId: b.spaceId, body: b.body.value, version: 1 });
      return reply(200, view(pages.get(id), true));
    }
    if (pageProps) {
      if (method === 'POST') {
        const b = JSON.parse(init.body);
        props.set(`${pageProps[1]}:${b.key}`, b.value);
        return reply(200, { key: b.key });
      }
      const key = q.get('key');
      return reply(200, { results: props.has(`${pageProps[1]}:${key}`) ? [{ key }] : [] });
    }
    if (onePage) {
      const page = pages.get(onePage[1]);
      if (!page) return reply(404, {});
      if (method === 'GET') return reply(200, view(page, withBody));
      if (method === 'PUT') {
        const b = JSON.parse(init.body);
        if (b.version.number !== page.version + 1) return reply(409, { message: 'stale version' });
        page.body = b.body.value;
        page.version = b.version.number;
        return reply(200, view(page, true));
      }
    }
    if (method === 'POST' && pageLabels) {
      const names = JSON.parse(init.body).map((l) => l.name);
      labels.set(pageLabels[1], [...new Set([...(labels.get(pageLabels[1]) ?? []), ...names])]);
      return reply(200, { results: names });
    }
    return reply(404, { message: `unhandled ${method} ${path}` });
  }

  return { cf, pages, props, labels, spaces };
}

const impact = (overrides = {}) => ({
  node: { nodeId: 'svc:gateway', label: 'gateway', kind: 'service', repo: 'RepoA', endpoints: 12 },
  endpointCount: 12,
  consumers: [
    {
      service: 'client',
      repo: 'RepoB',
      provenance: 'deterministic',
      confidence: 1,
      usages: 7,
      endpointsUsed: [{ endpoint: 'rpc:Create', usages: 4 }],
      sampleCallSites: [{ repo: 'RepoB', path: 'src/a.ts', line: 9 }],
    },
  ],
  providers: [],
  groups: [{ nodeId: 'grp:1', label: 'RPC', contractKind: 'rpc', contracts: 12 }],
  ...overrides,
});
const workspace = { id: 'ws1', name: 'Cluster', repos: [{ id: 'RepoA', sha: 'abc123' }] };
const base = { spaceKey: 'DOCS', workspace, consoleBase: 'https://parallax.test/app' };

describe('esc', () => {
  it('escapes markup so graph-derived text cannot inject XHTML', () => {
    expect(esc('<img onerror="x">&')).toBe('&lt;img onerror=&quot;x&quot;&gt;&amp;');
  });
});

describe('renderTemplate', () => {
  it('replaces bare tokens', () => {
    expect(renderTemplate('<h2>x</h2>{{a}}', { a: '<table/>' })).toBe('<h2>x</h2><table/>');
  });
  it('removes the paragraph Confluence wraps around a token so blocks stay valid', () => {
    expect(renderTemplate('<p>{{a}}</p>', { a: '<table/>' })).toBe('<table/>');
    expect(renderTemplate('<p class="x"> {{ a }} </p>', { a: '<ul/>' })).toBe('<ul/>');
  });
  it('drops unknown tokens instead of printing them', () => {
    expect(renderTemplate('a{{nope}}b', {})).toBe('ab');
  });
});

describe('splitHuman', () => {
  it('splits at the Human notes heading, tolerating heading attributes', () => {
    const { machine, human } = splitHuman('<p>m</p><h2 local-id="9">Human notes</h2><p>h</p>');
    expect(machine).toBe('<p>m</p>');
    expect(human).toBe('<h2 local-id="9">Human notes</h2><p>h</p>');
  });
  it('treats a page without the heading as all machine', () => {
    expect(splitHuman('<p>m</p>')).toEqual({ machine: '<p>m</p>', human: '' });
  });
});

describe('parseAnnotations', () => {
  const macro = (rows) =>
    `<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table><tbody>${rows}</tbody></table></ac:rich-text-body></ac:structured-macro>`;

  it('returns null for the untouched scaffold', () => {
    const scaffold = buildFragments({
      impact: impact(),
      workspace,
      generatedAt: 'now',
      links: {},
    }).annotations;
    expect(parseAnnotations(scaffold)).toBeNull();
  });
  it('reads filled values and ignores placeholders and unknown rows', () => {
    const body = macro(
      '<tr><th><p>Owner</p></th><td><p>Platform &amp; Infra</p></td></tr>' +
        '<tr><th>Criticality</th><td>High</td></tr>' +
        '<tr><th>Runbook</th><td>(add runbook)</td></tr>' +
        '<tr><th>Mood</th><td>happy</td></tr>',
    );
    expect(parseAnnotations(body)).toEqual({ owner: 'Platform & Infra', criticality: 'High' });
  });
  it('returns null when the page has no details macro', () => {
    expect(parseAnnotations('<p>nothing</p>')).toBeNull();
  });
});

describe('publishServicePage', () => {
  let conf;
  beforeEach(() => {
    conf = fakeConfluence();
  });

  it('creates the template page and the service page, tagged and linked', async () => {
    const out = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });

    expect(out).toMatchObject({
      action: 'created',
      title: pageTitle('gateway'),
      templateCreated: true,
    });
    const titles = [...conf.pages.values()].map((p) => p.title).sort();
    expect(titles).toEqual([TEMPLATE_TITLE, pageTitle('gateway')].sort());

    const page = conf.pages.get(out.pageId);
    expect(page.body).toContain('MACHINE MADE');
    expect(page.body).toContain('PARALLAX');
    expect(page.body).toContain('LAIN');
    expect(page.body).toContain('RepoB:src/a.ts:9');
    expect(page.body).toContain('RepoA@abc123');
    expect(page.body).toContain('https://parallax.test/app/orgs/ws1/services/gateway');
    expect(page.body).toContain('/issues/?jql=text%20~%20%22gateway%22');
    expect(conf.labels.get(out.pageId)).toEqual(['parallax', 'lain', 'machine-made']);
    expect(conf.props.has(`${out.pageId}:${MARKER_KEY}`)).toBe(true);

    const templateId = [...conf.pages.values()].find((p) => p.title === TEMPLATE_TITLE).id;
    expect(conf.props.has(`${templateId}:${TEMPLATE_MARKER_KEY}`)).toBe(true);
  });

  it('says how many endpoints were left out when the list is shortened', async () => {
    const big = impact();
    big.consumers[0].endpointsUsedTotal = 20; // one listed, twenty in the graph
    const out = await publishServicePage({ cf: conf.cf, impact: big, ...base });
    expect(conf.pages.get(out.pageId).body).toContain('and 19 more');

    const small = impact(); // no total given: nothing hidden, nothing claimed
    const out2 = await publishServicePage({
      cf: fakeConfluence().cf,
      impact: small,
      ...base,
    });
    expect(out2.action).toBe('created');
  });

  it('escapes graph-derived names in the page', async () => {
    const hostile = impact();
    hostile.consumers[0].service = '<script>alert(1)</script>';
    const out = await publishServicePage({ cf: conf.cf, impact: hostile, ...base });
    const body = conf.pages.get(out.pageId).body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('updates the same page on the second run instead of duplicating it', async () => {
    const first = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const second = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });

    expect(second).toMatchObject({
      action: 'updated',
      pageId: first.pageId,
      templateCreated: false,
    });
    expect(conf.pages.get(first.pageId).version).toBe(2);
    const generated = [...conf.pages.values()].filter((p) => p.title === pageTitle('gateway'));
    expect(generated).toHaveLength(1);
  });

  it('regenerates the machine part but keeps what humans wrote below Human notes', async () => {
    const first = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const page = conf.pages.get(first.pageId);
    page.body = page.body
      .replace('(add owner)', 'Platform team')
      .concat('<p>Remember the freeze.</p>');

    const changed = impact();
    changed.consumers[0].usages = 99;
    await publishServicePage({ cf: conf.cf, impact: changed, ...base });

    expect(page.body).toContain('>99<');
    expect(page.body).not.toContain('>7<');
    expect(page.body).toContain('Platform team');
    expect(page.body).toContain('Remember the freeze.');
  });

  it('refuses to overwrite a same-titled page that Parallax did not create', async () => {
    conf.pages.set('7', {
      id: '7',
      title: pageTitle('gateway'),
      spaceId: '10',
      body: '<p>Written by a person.</p>',
      version: 1,
    });
    const out = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });

    expect(out.error).toContain('not generated by Parallax');
    expect(conf.pages.get('7').body).toBe('<p>Written by a person.</p>');
    expect(conf.pages.get('7').version).toBe(1);
  });

  it('reports an unknown space without creating anything', async () => {
    const out = await publishServicePage({
      cf: conf.cf,
      impact: impact(),
      ...base,
      spaceKey: 'NOPE',
    });
    expect(out.error).toContain("No Confluence space with key 'NOPE'");
    expect(conf.pages.size).toBe(0);
  });

  it('uses a template edited by a human', async () => {
    await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const template = [...conf.pages.values()].find((p) => p.title === TEMPLATE_TITLE);
    template.body = '<p>Custom layout</p><p>{{consumers}}</p>';
    conf.pages.delete([...conf.pages.values()].find((p) => p.title === pageTitle('gateway')).id);

    const out = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const body = conf.pages.get(out.pageId).body;
    expect(body).toContain('Custom layout');
    expect(body).toContain('<strong>client</strong>');
    expect(body).not.toContain('<p><table>');
    expect(body).not.toContain('MACHINE MADE');
  });

  it('falls back to the built-in template when the template page is empty', async () => {
    await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const template = [...conf.pages.values()].find((p) => p.title === TEMPLATE_TITLE);
    expect(template.body).toBe(DEFAULT_TEMPLATE);
  });
});

describe('lookupAnnotations', () => {
  it('returns the page link and the filled-in annotations', async () => {
    const conf = fakeConfluence();
    const out = await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    const page = conf.pages.get(out.pageId);
    page.body = page.body
      .replace('(add owner)', 'Platform team')
      .replace('(add criticality)', 'High');

    const found = await lookupAnnotations(conf.cf, 'gateway');
    expect(found.annotations).toEqual({ owner: 'Platform team', criticality: 'High' });
    expect(found.pageUrl).toBe(
      `${BASE}/wiki/spaces/DOCS/pages/${out.pageId}/${encodeURIComponent(pageTitle('gateway'))}`,
    );
  });

  it('returns null when no page exists and null annotations when untouched', async () => {
    const conf = fakeConfluence();
    expect(await lookupAnnotations(conf.cf, 'ghost')).toBeNull();
    await publishServicePage({ cf: conf.cf, impact: impact(), ...base });
    expect((await lookupAnnotations(conf.cf, 'gateway')).annotations).toBeNull();
  });
});
