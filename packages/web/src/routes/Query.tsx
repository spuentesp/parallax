import type * as React from 'react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { type GraphQueryOp, type GraphQueryResultDto, useGraphQuery } from '../api/hooks.js';

// Consulta estructurada (referencia "Query mode"): el pipeline find → connect → filter →
// group → sort → limit, con el conteo tras cada paso. Todo se ejecuta tal como se ve en
// los pasos, de sólo lectura, sobre el grafo vivo del motor. Cada paso es un objeto del
// lenguaje de `query_graph`; el motor valida los campos y dice cuáles acepta.

type OpName = GraphQueryOp['op'];
const OPS: readonly OpName[] = ['find', 'connect', 'filter', 'group', 'sort', 'limit'];

interface Step {
  id: number;
  op: OpName;
  params: string;
}

const PRESETS: Array<{ label: string; hint: string; steps: Array<[OpName, object]> }> = [
  {
    label: 'GraphQL call sites into each service',
    hint: 'Consumers bound to a provider, grouped by the provider service.',
    steps: [
      ['find', { type: 'Function', name: { glob: 'graphql-call:*' } }],
      ['connect', { edge: 'Binds', direction: 'outgoing', depth: 1 }],
      ['group', { by: 'service' }],
      ['sort', { by: 'count', direction: 'desc' }],
      ['limit', { count: 10 }],
    ],
  },
  {
    label: 'HTTP client calls by repo',
    hint: 'Every outbound HTTP call the analyzer found, per repository.',
    steps: [
      ['find', { type: 'HttpClientCall' }],
      ['group', { by: 'repo' }],
      ['sort', { by: 'count', direction: 'desc' }],
    ],
  },
  {
    label: 'Database tables',
    hint: 'Tables the data-layer sensor found, by name.',
    steps: [
      ['find', { type: 'Table' }],
      ['sort', { by: 'name', direction: 'asc' }],
      ['limit', { count: 25 }],
    ],
  },
];

let nextId = 1;
const toSteps = (p: (typeof PRESETS)[number]): Step[] =>
  p.steps.map(([op, params]) => ({ id: nextId++, op, params: JSON.stringify(params) }));

type Parsed = { ok: true; ops: GraphQueryOp[] } | { ok: false; error: string };

function parseSteps(steps: readonly Step[]): Parsed {
  const ops: GraphQueryOp[] = [];
  for (const [i, s] of steps.entries()) {
    let params: unknown = {};
    if (s.params.trim() !== '') {
      try {
        params = JSON.parse(s.params);
      } catch {
        return { ok: false, error: `Step ${i + 1} (${s.op}): the parameters are not valid JSON.` };
      }
    }
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, error: `Step ${i + 1} (${s.op}): the parameters must be a JSON object.` };
    }
    ops.push({ ...(params as Record<string, unknown>), op: s.op });
  }
  return { ok: true, ops };
}

const errorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const b = e.body as { detail?: unknown } | null;
    return typeof b?.detail === 'string' ? b.detail : `The server answered ${e.status}.`;
  }
  return e instanceof Error ? e.message : 'The query failed.';
};

export function Query(): React.ReactElement {
  const { orgId } = useParams();
  const run = useGraphQuery(orgId);
  const [steps, setSteps] = useState<Step[]>(() => toSteps(PRESETS[0] as (typeof PRESETS)[number]));
  const [view, setView] = useState<'table' | 'json'>('table');
  const [copied, setCopied] = useState<string | null>(null);
  const lastRun = useRef<GraphQueryOp[] | null>(null);

  const parsed = parseSteps(steps);
  const canRun = parsed.ok && steps.length > 0 && steps[0]?.op === 'find' && !run.isPending;
  const execute = () => {
    if (!parsed.ok) return;
    lastRun.current = parsed.ops;
    run.mutate({ ops: parsed.ops });
  };
  const update = (id: number, patch: Partial<Step>) =>
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  const curl = (ops: GraphQueryOp[]) =>
    `curl -s -X POST "${window.location.origin}/api/workspaces/${orgId}/graph-query" \\\n  -H "Authorization: Bearer $PARALLAX_TOKEN" -H "content-type: application/json" \\\n  -d '${JSON.stringify({ ops })}'`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6 pb-24" data-testid="query-page">
      <div>
        <p className="text-xs text-muted">
          <Link to={`/orgs/${orgId}`} className="hover:underline">
            Workspace
          </Link>{' '}
          › Query
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Query</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Build a pipeline over the engine&apos;s graph. The engine runs the steps shown, read-only,
          on every repo in the workspace and the answers are added up. The step syntax is the
          engine&apos;s own; it names the accepted fields when one is wrong.
        </p>
      </div>

      <section aria-label="Starting points" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.hint}
            onClick={() => setSteps(toSteps(p))}
            className="rounded-full border border-border-strong px-3 py-1 text-xs text-accent hover:bg-accent-soft"
          >
            {p.label}
          </button>
        ))}
      </section>

      <section aria-label="Pipeline" className="rounded-xl border border-border bg-surface">
        <ol className="divide-y divide-border">
          {steps.map((s, i) => {
            const count = run.data?.steps[i];
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="w-5 text-xs tabular-nums text-muted">{i + 1}</span>
                <select
                  aria-label={`Step ${i + 1} operation`}
                  value={s.op}
                  onChange={(e) => update(s.id, { op: e.target.value as OpName })}
                  className="h-8 rounded-md border border-border-strong bg-surface-2 px-2 font-mono text-xs"
                >
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`Step ${i + 1} parameters (JSON)`}
                  value={s.params}
                  spellCheck={false}
                  onChange={(e) => update(s.id, { params: e.target.value })}
                  className="h-8 min-w-[16rem] flex-1 rounded-md border border-border-strong bg-surface-2 px-2 font-mono text-xs outline-none focus:border-accent"
                />
                {count && count.op === s.op && (
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                    {count.nodes.toLocaleString('en-US')} nodes
                    {count.edges > 0 && ` · ${count.edges.toLocaleString('en-US')} edges`}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => setSteps((all) => all.filter((x) => x.id !== s.id))}
                  className="rounded px-1.5 text-muted hover:text-error"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-3">
          <button
            type="button"
            onClick={() =>
              setSteps((all) => [
                ...all,
                { id: nextId++, op: all.length === 0 ? 'find' : 'filter', params: '{}' },
              ])
            }
            className="text-xs text-accent hover:underline"
          >
            + Add step
          </button>
          <button
            type="button"
            disabled={!canRun}
            onClick={execute}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {run.isPending ? 'Running…' : 'Run'}
          </button>
        </div>
        {!parsed.ok && <p className="px-3 pb-3 text-xs text-error">{parsed.error}</p>}
        {parsed.ok && steps[0]?.op !== 'find' && (
          <p className="px-3 pb-3 text-xs text-error">A query starts with a find step.</p>
        )}
      </section>

      {run.isError && (
        <p
          role="alert"
          className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error"
        >
          {errorText(run.error)}
        </p>
      )}

      {run.data && (
        <Results
          data={run.data}
          view={view}
          onView={setView}
          onCopy={(what, text) => void copy(what, text)}
          copied={copied}
          ops={lastRun.current ?? []}
          curl={curl}
        />
      )}
      <p className="text-xs text-muted">
        Queries are read-only. They run on the live graph, so a re-run after a re-index can return
        different rows.
      </p>
    </div>
  );
}

function Results({
  data,
  view,
  onView,
  onCopy,
  copied,
  ops,
  curl,
}: {
  data: GraphQueryResultDto;
  view: 'table' | 'json';
  onView: (v: 'table' | 'json') => void;
  onCopy: (what: string, text: string) => void;
  copied: string | null;
  ops: GraphQueryOp[];
  curl: (ops: GraphQueryOp[]) => string;
}): React.ReactElement {
  const rows = data.groups ?? data.nodes ?? [];
  const analyzed = data.scope.analyzed.length;
  const all = analyzed + data.scope.failed.length;
  const unit = data.groups ? 'groups' : 'rows';
  return (
    <section
      aria-label="Results"
      className="rounded-xl border border-border bg-surface"
      data-testid="query-results"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-xs text-muted">
        <span>
          {rows.length.toLocaleString('en-US')} of {data.total.toLocaleString('en-US')} {unit} ·
          scope: {analyzed} of {all} repos analyzed · {(data.elapsedMs / 1000).toFixed(1)} s
        </span>
        <span className="ml-auto flex gap-1">
          {(['table', 'json'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onView(v)}
              className={`rounded px-2 py-0.5 ${view === v ? 'bg-accent-soft text-accent' : ''}`}
            >
              {v === 'table' ? 'Table' : 'JSON'}
            </button>
          ))}
        </span>
      </div>
      {data.scope.failed.length > 0 && (
        <p className="border-b border-border p-3 text-xs text-error" role="status">
          {data.scope.failed.length} repo{data.scope.failed.length === 1 ? '' : 's'} did not answer,
          so these rows leave them out:{' '}
          {data.scope.failed.map((f) => `${f.repo} (${f.error})`).join('; ')}
        </p>
      )}
      {data.engineTruncated && (
        <p className="border-b border-border p-3 text-xs text-muted" role="status">
          The engine cut at least one repo&apos;s result short, so counts are partial. Narrow the
          query with a filter.
        </p>
      )}
      <div className="overflow-x-auto">
        {view === 'json' ? (
          <pre className="max-h-96 overflow-auto p-3 font-mono text-xs">
            {JSON.stringify(rows, null, 2)}
          </pre>
        ) : data.groups ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Group
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Call sites
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  By repo
                </th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.key} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{g.key}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {g.count.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {Object.entries(g.byRepo)
                      .map(([r, n]) => `${r} ${n.toLocaleString('en-US')}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Repo
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Location
                </th>
              </tr>
            </thead>
            <tbody>
              {(data.nodes ?? []).map((n) => (
                <tr key={`${n.repo}|${n.id}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{n.name}</td>
                  <td className="px-3 py-2 text-xs">{n.type}</td>
                  <td className="px-3 py-2 text-xs text-muted">{n.repo}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">
                    {n.path ? `${n.path}${n.line ? `:${n.line}` : ''}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length === 0 && <p className="p-3 text-sm text-muted">The query matched nothing.</p>}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-border p-3 text-xs">
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => onCopy('pipeline', JSON.stringify({ ops }, null, 2))}
        >
          Copy pipeline
        </button>
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => onCopy('curl', curl(ops))}
        >
          Copy as cURL
        </button>
        {copied && <span className="text-muted">Copied {copied}.</span>}
      </div>
    </section>
  );
}
