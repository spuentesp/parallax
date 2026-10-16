import type * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { type AssessmentSummary, useAssessmentList } from '../api/hooks.js';
import { AssessmentForm } from '../components/AssessmentForm.js';

export function Assessments(): React.ReactElement {
  const { orgId } = useParams();
  const [searchParams] = useSearchParams();
  const preselectedRepo = searchParams.get('repo') ?? undefined;
  const { data, isLoading, error } = useAssessmentList(orgId);
  const items = data?.assessments ?? [];

  return (
    <div className="p-6">
      <Link to={`/orgs/${orgId ?? ''}`} className="text-xs text-accent">
        ← Volver al hub de {orgId}
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Assessments</h1>
        <p className="text-sm mt-1 text-muted">
          Informes de impacto persistidos. Cada uno referencia SHAs concretos y se sirve igual por
          web y por MCP.
        </p>
      </div>

      <AssessmentForm orgId={orgId ?? ''} preselectedRepo={preselectedRepo} />

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-error">{String(error)}</p>}

      <div className="space-y-3">
        {items.map((a) => (
          <AssessmentRow key={a.id} a={a} orgId={orgId ?? ''} />
        ))}
        {items.length === 0 && !isLoading && (
          <div className="text-center py-12 rounded-xl border border-dashed border-border">
            <div className="text-3xl mb-2">◉</div>
            <div className="text-sm text-muted">
              No assessments yet. Run one from a workspace to see its impact report.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AssessmentRow({ a, orgId }: { a: AssessmentSummary; orgId: string }): React.ReactElement {
  return (
    <Link
      to={`/orgs/${orgId ?? ''}/assessments/${a.id}`}
      className="block rounded-xl p-4 bg-surface border border-border hover:border-accent transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted">{a.id}</span>
            <StatusBadge status={a.status} />
          </div>
          <div className="text-sm mt-1">
            {a.findingCount} finding{a.findingCount === 1 ? '' : 's'}
            {' · '}
            <span className="text-muted font-mono text-xs">{a.inputDigest.slice(0, 24)}</span>
          </div>
          {a.coverageSummary && (
            <div className="text-xs text-muted mt-1 line-clamp-2">{a.coverageSummary}</div>
          )}
        </div>
        <div className="text-right text-xs text-muted whitespace-nowrap">
          <div>{new Date(a.createdAt).toLocaleString()}</div>
          <div className="mt-1 text-accent">Ver informe →</div>
        </div>
      </div>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }): React.ReactElement {
  const style =
    status === 'READY'
      ? 'bg-success/15 text-success'
      : status === 'PARTIAL'
        ? 'bg-warning/15 text-warning'
        : status === 'FAILED' || status === 'CANCELLED'
          ? 'bg-error/15 text-error'
          : 'bg-bg text-muted';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${style}`} data-status={status}>
      {status}
    </span>
  );
}
