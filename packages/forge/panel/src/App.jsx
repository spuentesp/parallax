import { useCallback, useEffect, useState } from 'react';
import { isMock, loadReview, openUrl } from './bridge.js';
import { countsLine, driftTone, expectedLine, prUrl, reachLine, statusLabel } from './format.js';
import Graph from './Graph.jsx';
import { shortLabel } from './layout.js';

const MAX_UNNAMED_SHOWN = 5;

function Link({ href, children }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

function Loading() {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="skeleton wide" />
      <div className="skeleton" />
      <div className="skeleton graph-skeleton" />
      <p className="muted">Reading the ticket and asking Parallax…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="state error" role="alert">
      <strong>Parallax could not be read.</strong>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function Expected({ expected }) {
  const hasGraph = expected.graph?.nodes?.length > 0;
  return (
    <section className="card">
      <h2>What the ticket predicts</h2>
      <p className="lead">{expectedLine(expected.summary)}</p>
      {hasGraph && (
        <>
          <Graph graph={expected.graph} />
          <p className="legend">
            <span className="swatch proven" /> proven by code
            <span className="swatch inferred" /> inferred, needs checking
            <span className="swatch dot" /> criticality
          </p>
        </>
      )}
      {!hasGraph && (
        <p className="muted">
          Name a service or endpoint in the ticket, for example a method like
          <code> CreateSandbox</code> or a route like <code>POST /v1/chat/completions</code>.
        </p>
      )}
      {expected.unmatchedTerms?.length > 0 && (
        <p className="muted small">
          Not found in the architecture:{' '}
          {expected.unmatchedTerms.map((t) => (
            <code key={t}>{t}</code>
          ))}
        </p>
      )}
    </section>
  );
}

function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <div className="steps">
      <h3>What to do next</h3>
      <ol>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function Unnamed({ items }) {
  if (!items?.length) return null;
  const shown = items.slice(0, MAX_UNNAMED_SHOWN);
  return (
    <div className="unnamed">
      <h3>Touched, but never named in the ticket</h3>
      <ul>
        {shown.map((f) => (
          <li key={f.endpoint}>
            <span className="mono" title={f.endpoint}>
              {shortLabel(f.endpoint)}
            </span>
            <span className="muted"> · {f.service} · </span>
            <span className={`chip ${f.class === 'Verified' ? 'good' : 'notice'}`}>
              {f.class === 'Verified' ? 'proven' : 'needs investigation'}
            </span>
            <span className="muted small"> {reachLine(f)}</span>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <p className="muted small">and {items.length - shown.length} more</p>
      )}
    </div>
  );
}

function CodeRisk({ code }) {
  if (!code?.symbols?.length) return null;
  return (
    <div className="code">
      <h3>
        Code edited in {code.repo}
        <span className="muted small">
          {' '}
          · {code.filesChanged} files changed, {code.filesAnalyzed} analysed
        </span>
      </h3>
      <ul>
        {code.symbols.map((s) => (
          <li key={`${s.path}:${s.line}:${s.name}`}>
            <span className="mono">{s.name}</span>
            <span className={`chip risk-${s.risk}`}>{s.risk} risk</span>
            {s.untested && <span className="chip notice">untested</span>}
            <div className="muted small mono">
              {s.path}:{s.line}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PullRequest({ pr }) {
  if (pr.note) {
    return (
      <section className="card">
        <h2>Linked pull request</h2>
        <p className="muted">
          <Link href={pr.url}>{pr.url.replace('https://github.com/', '')}</Link>
        </p>
        <p>{pr.note}</p>
      </section>
    );
  }

  const { assessment: a, drift } = pr;
  const tone = driftTone(drift);
  const url = prUrl(a.pr);

  return (
    <section className="card">
      <h2>
        What the pull request actually changed
        <span className="pill">{statusLabel(a.status, a.coverage.complete)}</span>
      </h2>
      <p className="muted small">
        {url ? <Link href={url}>{a.pr}</Link> : a.pr} · {countsLine(a.counts)}
      </p>

      <div className={`headline ${tone}`}>
        <strong>{drift.headline}</strong>
      </div>

      <Unnamed items={drift.touchedButNotNamed} />
      <CodeRisk code={a.codeImpact} />

      {drift.caveat && <p className="caveat">{drift.caveat}</p>}
      <Steps steps={pr.nextSteps} />

      {a.explanation && (
        <details className="explain">
          <summary>Explanation written by a language model ({a.explanation.model})</summary>
          <p>{a.explanation.text}</p>
          <p className="muted small">{a.explanation.note}</p>
        </details>
      )}
    </section>
  );
}

function Contacts({ contacts }) {
  if (!contacts?.length) return null;
  return (
    <p className="contacts">
      <strong>Talk to:</strong>{' '}
      {contacts.map((c) => (
        <span className="chip owner" key={c.service}>
          {c.owner} <span className="muted">· {c.service}</span>
          {c.criticality && <span className="muted"> · {c.criticality}</span>}
        </span>
      ))}
    </p>
  );
}

export default function App() {
  const [state, setState] = useState({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await loadReview();
      setState(data?.error ? { status: 'error', message: data.error } : { status: 'ready', data });
    } catch (e) {
      setState({ status: 'error', message: String(e?.message ?? e) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <ErrorState message={state.message} onRetry={load} />;

  const { data } = state;
  return (
    <main className="panel">
      <header className="bar">
        <h1>
          Parallax <span className="muted">impact{data.issueKey ? ` · ${data.issueKey}` : ''}</span>
        </h1>
        <button type="button" className="quiet" onClick={load} aria-label="Refresh">
          Refresh
        </button>
      </header>

      <Contacts contacts={data.contacts} />
      <Expected expected={data.expected} />
      {data.pullRequests.map((pr) => (
        <PullRequest key={pr.url} pr={pr} />
      ))}
      {data.nextSteps && (
        <section className="card">
          <Steps steps={data.nextSteps} />
        </section>
      )}

      <footer className="muted small">
        The prediction comes from the ticket's words; the evidence comes from the code graph.
        {isMock() ? ' (mock data)' : ''}
      </footer>
    </main>
  );
}
