// Cobertura presentada al usuario.
//
// LAIN informa qué vio y qué pudo resolver, pero no registra un repo que
// nunca entró al snapshot: simplemente no aparece. §6 hace de Parallax la
// autoridad sobre "qué código fue revisado" (el manifiesto), y INV 3 exige
// que una omisión sea visible y no se lea como cero consumidores afectados.
//
// `presentCoverage` une las dos fuentes: la cobertura del motor y las
// exclusiones que el propio manifiesto declaró.

export interface CoverageRepoNote {
  repo: string;
  reason: string;
}

export interface LainCoverage {
  complete?: boolean;
  scope?: {
    configured_only?: boolean;
    reviewed?: Array<{ repo?: string; commit?: string; dirty?: boolean } | string>;
    unreviewed?: Array<Record<string, unknown>>;
    excluded?: Array<Record<string, unknown>>;
  };
  [k: string]: unknown;
}

export interface Manifest {
  /** Repos configurados en el workspace. */
  readonly configured: readonly string[];
  /** Repos declarados fuera del alcance de esta solicitud. */
  readonly excluded: readonly string[];
}

export interface PresentedCoverage {
  complete: boolean;
  scope: {
    configured_only: boolean;
    reviewed: string[];
    unreviewed: CoverageRepoNote[];
    excluded: CoverageRepoNote[];
  };
  /** Relato corto para informes y comentarios: nunca dice "sin impacto". */
  summary: string;
  /** Señales del motor que conservamos sin traducir. */
  raw: LainCoverage;
}

function repoName(r: { repo?: string } | string): string {
  return typeof r === 'string' ? r : (r.repo ?? '');
}

export function presentCoverage(lain: LainCoverage, manifest: Manifest): PresentedCoverage {
  const reviewed = (lain.scope?.reviewed ?? []).map(repoName).filter(Boolean);
  const excludedNotes: CoverageRepoNote[] = manifest.excluded.map((repo) => ({
    repo,
    reason: 'excluded',
  }));

  // Lo que el motor declaró no revisado se respeta tal cual; sólo agregamos
  // las omisiones que el motor no puede ver porque el repo no entró al snapshot.
  const engineUnreviewed: CoverageRepoNote[] = (lain.scope?.unreviewed ?? [])
    .map((u) => {
      const o = u as { repo?: string; reason?: string };
      return { repo: o.repo ?? '', reason: o.reason ?? 'not_ready' };
    })
    .filter((n) => n.repo.length > 0);

  const known = new Set([...reviewed, ...engineUnreviewed.map((n) => n.repo)]);
  const unreviewed = [...engineUnreviewed, ...excludedNotes.filter((n) => !known.has(n.repo))];

  // `complete` es sólo true si el motor lo dijo y además no queda nada fuera
  // del alcance declarado por el manifiesto.
  const complete = (lain.complete ?? false) && unreviewed.length === 0;

  const parts: string[] = [];
  parts.push(`revisados: ${reviewed.length > 0 ? reviewed.join(', ') : '(ninguno)'}`);
  if (unreviewed.length > 0) {
    parts.push(`no revisados: ${unreviewed.map((n) => `${n.repo} (${n.reason})`).join(', ')}`);
  }
  parts.push(
    complete
      ? 'cobertura completa'
      : 'la cobertura está incompleta: un resultado vacío no autoriza a concluir ausencia de impacto',
  );

  return {
    complete,
    scope: {
      configured_only: lain.scope?.configured_only ?? true,
      reviewed,
      unreviewed,
      excluded: excludedNotes,
    },
    summary: parts.join(' · '),
    raw: lain,
  };
}
