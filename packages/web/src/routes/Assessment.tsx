// Vista de cambio (§2): el informe de impacto persistido. Muestra identidad,
// hallazgos del motor, cobertura presentada y evidencia — sin mezclar lo que
// observó el analizador con lo que diga un modelo (INV 2).

import type { AssessmentFinding } from '@parallax/shared/domain';
import type * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAssessment } from '../api/hooks.js';
import { CodeImpactSection } from '../components/CodeImpactSection.js';
import { StatusBadge } from './Assessments.js';

export function Assessment(): React.ReactElement {
  const { assessmentId, orgId } = useParams<{ assessmentId: string; orgId?: string }>();
  const { data, isLoading, error } = useAssessment(assessmentId ?? null);
  const report = data?.assessment ?? null;

  if (isLoading) return <div className="p-6 text-sm text-muted">Loading report…</div>;
  if (error || !report) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Assessment not found.</p>
        <Link to={`/orgs/${orgId ?? ''}/assessments`} className="text-sm text-accent">
          ← Back to assessments
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link to={`/orgs/${orgId ?? ''}`} className="text-xs text-accent">
          ← Volver al hub de {orgId}
        </Link>{' '}
        <Link
          to={`/orgs/${orgId ?? ''}/assessments`}
          className="text-xs text-muted hover:text-accent"
        >
          ← Assessments
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              Impact report
              <StatusBadge status={report.status} />
            </h1>
            <div className="text-xs text-muted mt-1 font-mono">
              {report.id} · digest {report.inputDigest}
            </div>
          </div>
          <div className="text-right text-xs text-muted">
            <div>base {report.baseId ?? '—'}</div>
            <div>head {report.headId ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Lo que cambió */}
      <section>
        <h2 className="font-semibold mb-2">
          Findings <span className="text-muted font-normal">({report.findings.length})</span>
        </h2>
        {report.findings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            No se detectaron cambios de contrato.
          </div>
        ) : (
          <div className="space-y-2">
            {report.findings.map((f) => (
              <FindingCard
                key={`${f.service ?? f.endpoint?.key ?? f.kind}-${f.field ?? f.route ?? ''}-${f.impact?.class ?? ''}`}
                f={f}
              />
            ))}
          </div>
        )}
      </section>

      {/* El código que toca el PR y a cuánto alcanza: otra medida, junto a los contratos */}
      {report.codeImpact ? <CodeImpactSection impact={report.codeImpact} /> : null}

      {/* Cobertura — INV 3: la omisión es visible y un vacío no autoriza nada */}
      <section>
        <h2 className="font-semibold mb-2">Coverage</h2>
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                report.coverage?.complete
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning'
              }`}
            >
              {report.coverage?.complete ? 'complete' : 'incomplete'}
            </span>
          </div>
          {report.coverage?.summary && <p className="text-sm text-fg">{report.coverage.summary}</p>}
          <ScopeList
            label="Reviewed"
            items={report.coverage?.scope?.reviewed ?? []}
            tone="success"
          />
          <ScopeList
            label="Not reviewed"
            items={report.coverage?.scope?.unreviewed ?? []}
            tone="warning"
          />
          <ScopeList label="Excluded" items={report.coverage?.scope?.excluded ?? []} tone="muted" />
        </div>
      </section>

      {/* Evidencia */}
      <section>
        <h2 className="font-semibold mb-2">
          Evidence <span className="text-muted font-normal">({report.evidence.length})</span>
        </h2>
        {report.evidence.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            Sin evidencia registrada para este informe.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <table className="w-full text-xs font-mono">
              <tbody>
                {report.evidence.map((e) => (
                  <tr key={e.id} className="border-t border-border first:border-t-0">
                    <td className="px-4 py-2 text-muted whitespace-nowrap">{e.repo}</td>
                    <td className="px-4 py-2 text-muted whitespace-nowrap">{e.sha.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-accent break-all">{e.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* INV 2: lo del motor y lo del modelo van separados */}
      <section>
        <h2 className="font-semibold mb-2">Explanation</h2>
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-muted">
              {report.explanation.status}
            </span>
            <span className="text-xs text-muted">
              model: {report.explanation.model ?? '—'} · revision{' '}
              {report.explanation.revision ?? '—'}
            </span>
          </div>
          {report.explanation.narrative ? (
            <div className="mt-3 whitespace-pre-wrap text-sm">{report.explanation.narrative}</div>
          ) : null}
          <p className="text-xs text-muted mt-2">
            La explicación del modelo no modifica los findings del analizador. Una explicación no
            puede promover NeedsInvestigation a Verified.
          </p>
        </div>
      </section>
    </div>
  );
}

function FindingCard({ f }: { f: AssessmentFinding }): React.ReactElement {
  const endpoint = f.endpoint?.key ?? f.route ?? f.field ?? '—';
  const impacted = f.affected ?? [];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-bg text-muted">{f.kind}</span>
            <span className="font-mono text-xs text-accent">{endpoint}</span>
          </div>
          <div className="text-xs text-muted mt-1">
            {f.field ? `field: ${f.field}` : null}
            {f.compat ? ` · compat: ${f.compat}` : null}
            {f.side ? ` · side: ${f.side}` : null}
            {f.service ? ` · service: ${f.service}` : null}
          </div>
        </div>
        {f.impact?.class && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
              f.impact.class === 'Verified'
                ? 'bg-success/15 text-success'
                : f.impact.class === 'NeedsInvestigation'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-bg text-muted'
            }`}
          >
            {f.impact.class}
          </span>
        )}
      </div>

      {impacted.length > 0 && (
        <div className="mt-3 text-xs text-muted">
          <div className="uppercase tracking-wide mb-1">Affected</div>
          <ul className="space-y-0.5">
            {impacted.map((a) => (
              <li
                key={`${a.service ?? ''}-${a.consumer ?? ''}-${a.class ?? ''}`}
                className="font-mono"
              >
                {a.service ?? '—'}
                {a.consumer ? ` · ${a.consumer}` : ''}
                {a.class ? ` · ${a.class}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScopeList({
  label,
  items,
  tone,
}: {
  label: string;
  items: Array<{ repo: string; reason: string } | string>;
  tone: 'success' | 'warning' | 'muted';
}): React.ReactElement | null {
  if (items.length === 0) return null;
  const cls =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-muted';
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted mb-1">{label}</div>
      <ul className={`text-xs font-mono ${cls}`}>
        {items.map((it) => {
          const repo = typeof it === 'string' ? it : it.repo;
          const reason = typeof it === 'string' ? '' : it.reason;
          return (
            <li key={repo}>
              {repo}
              {reason ? ` (${reason})` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
