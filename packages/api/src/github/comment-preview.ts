// Comment preview — el markdown que se publicaría, generado localmente.
//
// NUNCA se envía a GitHub. Lo que produce esta función es un documento para
// revisar antes de decidir: conserva el SHA evaluado y los límites de cobertura
// (§2), y dice de forma explícita que es una vista previa para que nadie lo
// confunda con un comentario ya publicado.

import { codeImpactMarkdown } from '../pr-review/render.js';
import type { AssessmentApiModel } from '../services/assessments.js';

// El informe persiste los cambios del motor tal cual; aquí sólo se leen para
// redactarlos. No se reclasifica nada (INV 2).
interface PreviewFinding {
  kind: string;
  side?: string;
  field?: string;
  route?: string;
  compat?: string;
  service?: string;
  endpoint?: { key?: string; service?: string };
  impact?: { class?: string; reasons?: string[] | string };
  affected?: Array<{ service?: string; class?: string; consumer?: string }>;
}

function asFinding(x: unknown): PreviewFinding {
  return (x ?? {}) as PreviewFinding;
}

export interface PreviewOptions {
  /** Nombre corto del repo en el workspace, para el encabezado. */
  readonly repoLabel?: string;
  /** Incluye los call-sites citados. Sólo lectura, nada se enlaza a GitHub. */
  readonly includeEvidence?: boolean;
}

export interface CommentPreview {
  /** Markdown listo para pegar. No se publica automáticamente. */
  readonly markdown: string;
  /** SHA que se evaluó: es lo que hace válido el informe (§5). */
  readonly evaluated: { baseSha: string | null; headSha: string | null; assessmentId: string };
  /** Límites de cobertura, tal cual van en el comentario. */
  readonly coverage: {
    complete: boolean;
    reviewed: string[];
    notReviewed: Array<{ repo: string; reason: string }>;
    summary: string | null;
  };
  readonly findingCount: number;
  readonly dryRun: true;
}

export function buildCommentPreview(
  report: AssessmentApiModel,
  opts: PreviewOptions = {},
): CommentPreview {
  const cov = (report.coverage ?? {}) as {
    complete?: boolean;
    summary?: string;
    scope?: {
      reviewed?: Array<{ repo?: string } | string>;
      unreviewed?: Array<{ repo?: string; reason?: string } | string>;
      excluded?: Array<{ repo?: string; reason?: string } | string>;
    };
  };
  const name = (x: { repo?: string } | string | undefined): string =>
    typeof x === 'string' ? x : (x?.repo ?? '');
  const reviewed = (cov.scope?.reviewed ?? []).map(name).filter(Boolean);
  const notReviewed = [...(cov.scope?.unreviewed ?? []), ...(cov.scope?.excluded ?? [])]
    .map((x) =>
      typeof x === 'string'
        ? { repo: x, reason: 'not_reviewed' }
        : {
            repo: x.repo ?? '',
            reason: x.reason ?? 'not_reviewed',
          },
    )
    .filter((n) => n.repo.length > 0);

  const complete = cov.complete === true;
  const lines: string[] = [];

  lines.push('<!-- parallax-impact-report (DRY RUN — preview, nothing was posted) -->');
  lines.push('');
  lines.push(`## Impact report${opts.repoLabel ? ` — ${opts.repoLabel}` : ''}`);
  lines.push('');
  lines.push(
    `**Evaluated SHAs** · base \`${report.baseId ?? '—'}\` → head \`${report.headId ?? '—'}\` · assessment \`${report.id}\``,
  );
  lines.push('');
  lines.push(
    '> This is a **preview generated locally**; this request posts nothing to GitHub or GitLab. Automatic reviews can post an advisory comment when the workspace enables comments.',
  );
  lines.push('');

  // Hallazgos, sin promover la certeza del motor (INV 2).
  lines.push(`### Findings (${report.findings.length})`);
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('_No contract changes detected._');
    lines.push('');
  } else {
    lines.push('| Change | Endpoint | Compat | Impact | Affected |');
    lines.push('|---|---|---|---|---|');
    for (const raw of report.findings) {
      const f = asFinding(raw);
      const change = f.field ? `${f.kind} \`${f.field}\`` : f.kind;
      const endpoint = f.endpoint?.key ?? f.route ?? '—';
      const impacted = f.impact?.class ?? '—';
      const affected = (f.affected ?? [])
        .map((a) => `\`${a.service ?? '?'}\` ${a.class ?? ''}`.trim())
        .join('<br>');
      lines.push(
        `| ${change} | \`${endpoint}\` | ${f.compat ?? '—'} | **${impacted}** | ${affected || '—'} |`,
      );
    }
    lines.push('');
  }

  // El código que toca el PR y a cuánto alcanza (informativo: no cambia las clases del motor).
  lines.push(...codeImpactMarkdown(report.codeImpact));

  // Cobertura: la omisión es visible y un vacío no autoriza a concluir (INV 3).
  lines.push(`### Coverage`);
  lines.push('');
  lines.push(complete ? '**complete**' : '**incomplete**');
  lines.push('');
  if (cov.summary) lines.push(cov.summary, '');
  if (reviewed.length > 0) lines.push(`- Reviewed: ${reviewed.map((r) => `\`${r}\``).join(', ')}`);
  for (const n of notReviewed) {
    lines.push(`- Not reviewed: \`${n.repo}\` (${n.reason})`);
  }
  if (!complete) {
    lines.push('');
    lines.push(
      '> Coverage is incomplete. An empty or partial result is **not** authorization to change the system.',
    );
  }
  lines.push('');

  // Evidencia citada, opcional: sólo referencias ya resueltas.
  if (opts.includeEvidence && report.evidence.length > 0) {
    lines.push(`### Evidence (${report.evidence.length})`);
    lines.push('');
    for (const e of report.evidence.slice(0, 20)) {
      lines.push(`- \`${e.repo}\` @ \`${e.sha.slice(0, 10)}\` · \`${e.path}\``);
    }
    if (report.evidence.length > 20) {
      lines.push(`- _…and ${report.evidence.length - 20} more._`);
    }
    lines.push('');
  }

  // La explicación del modelo va separada y nunca altera el motor (INV 2).
  lines.push(`### Explanation`);
  lines.push('');
  lines.push(
    `\`${report.explanation.status}\` · model \`${report.explanation.model ?? '—'}\` · revision \`${report.explanation.revision ?? '—'}\``,
  );
  lines.push('');
  if (report.explanation.narrative) {
    lines.push(report.explanation.narrative);
    lines.push('');
  }
  lines.push(
    'Model output does not change analyzer classification. It cannot promote `NeedsInvestigation` to `Verified`.',
  );

  return {
    markdown: lines.join('\n'),
    evaluated: {
      baseSha: report.baseId,
      headSha: report.headId,
      assessmentId: report.id,
    },
    coverage: {
      complete,
      reviewed,
      notReviewed,
      summary: cov.summary ?? null,
    },
    findingCount: report.findings.length,
    dryRun: true,
  };
}
