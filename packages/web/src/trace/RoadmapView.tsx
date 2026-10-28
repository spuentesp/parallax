import type * as React from 'react';
import type { BlastRadiusDto, RoadmapDto } from '../api/hooks.js';
import { TraceView } from './TracePanel.js';

// El resultado estructurado que acompaña a una respuesta de recorrido o de impacto.

export function BlastView({ blast }: { blast: BlastRadiusDto }): React.ReactElement {
  return (
    <div className="space-y-2 text-xs" data-testid="blast-view">
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-bg px-2 py-0.5">{blast.direct.length} services</span>
        <span className="rounded-full bg-bg px-2 py-0.5">{blast.totalUses} call sites</span>
        {blast.ripple.length > 0 && (
          <span className="rounded-full bg-bg px-2 py-0.5">
            {blast.ripple.length} in the second ring
          </span>
        )}
      </div>

      {blast.direct.map((d) => (
        <div
          key={d.service}
          className="rounded-lg border border-border p-2"
          data-testid={`blast-${d.service}`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{d.service}</span>
            <span className="text-muted">
              {d.uses} {d.uses === 1 ? 'use' : 'uses'}
            </span>
            <span className={d.provenance === 'inferred' ? 'text-warning' : 'text-success'}>
              {d.provenance === 'inferred' ? 'inferred' : 'recorded by the engine'}
            </span>
          </div>
          {d.fields.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted">
              reads: {d.fields.slice(0, 10).join(', ')}
            </p>
          )}
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted">
            {d.sites.map((s) => (
              <li key={`${s.path}:${s.line}`} className="break-all">
                {s.repo ? `${s.repo}:` : ''}
                {s.path}
                {s.line ? `:${s.line}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {blast.ripple.length > 0 && (
        <div data-testid="blast-ripple">
          <p className="text-[10px] uppercase tracking-wide text-muted">Second ring</p>
          <ul className="space-y-0.5">
            {blast.ripple.map((r) => (
              <li key={r.service}>
                <span className="font-medium">{r.service}</span>{' '}
                <span className="text-muted">
                  depends on {r.via} ({r.uses} {r.uses === 1 ? 'use' : 'uses'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blast.caveats.map((c) => (
        <p key={c} className="text-[11px] text-warning" data-testid="blast-caveat">
          {c}
        </p>
      ))}
    </div>
  );
}

export function RoadmapView({ roadmap }: { roadmap: RoadmapDto }): React.ReactElement {
  return roadmap.kind === 'blast' ? (
    <BlastView blast={roadmap.blast} />
  ) : (
    <TraceView trace={roadmap.trace} onSelect={() => {}} />
  );
}
