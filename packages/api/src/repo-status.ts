import { deriveLainRepoId } from './code-graph.js';

// Estado de cada repo configurado en Parallax frente a lo que LAIN tiene
// indexado. Son dos listas distintas: Parallax guarda lo que el usuario
// configuró; el mapa se construye con lo que LAIN revisó. Este cruce hace
// visible cualquier desajuste, sin modelo: sólo `list_services.scope`.

export type RepoIndexState = 'indexed' | 'unreviewed' | 'not_in_lain';

export interface ConfiguredRepo {
  id: string;
  uri: string;
  sha: string | null;
  local: string | null;
}

export interface RepoStatus extends ConfiguredRepo {
  /** repo_id con el que LAIN lo conoce (basename del checkout o de la URI). */
  lainRepoId: string;
  state: RepoIndexState;
  /** Commit que LAIN revisó (sólo si está indexado). */
  commit?: string;
  dirty?: boolean;
}

export interface LainScope {
  reviewed: ReadonlyArray<{ repo: string; commit: string; dirty: boolean }>;
  unreviewed: readonly string[];
}

export interface RepoStatusReport {
  repos: RepoStatus[];
  /** Repos que LAIN revisó y que el workspace no tiene configurados. */
  untracked: Array<{ repo: string; commit: string }>;
}

export function repoStatuses(
  configured: readonly ConfiguredRepo[],
  scope: LainScope,
): RepoStatusReport {
  const reviewed = new Map(scope.reviewed.map((r) => [r.repo, r]));
  const unreviewed = new Set(scope.unreviewed);
  const mine = new Set<string>();

  const repos = configured.map((c): RepoStatus => {
    const lainRepoId = deriveLainRepoId(c);
    mine.add(lainRepoId);
    const hit = reviewed.get(lainRepoId);
    if (hit) return { ...c, lainRepoId, state: 'indexed', commit: hit.commit, dirty: hit.dirty };
    return { ...c, lainRepoId, state: unreviewed.has(lainRepoId) ? 'unreviewed' : 'not_in_lain' };
  });

  const untracked = scope.reviewed
    .filter((r) => !mine.has(r.repo))
    .map((r) => ({ repo: r.repo, commit: r.commit }));
  return { repos, untracked };
}

/**
 * repos.yaml para LAIN a partir de los repos del workspace. Los ids son los que
 * LAIN usa (y los que el mapa espera), no los internos de Parallax. Un repo sin
 * checkout local se deja comentado: LAIN indexa directorios, no URLs.
 */
export function lainConfigYaml(workspaceId: string, repos: readonly ConfiguredRepo[]): string {
  const lines = [`data_dir: /var/parallax/lain-data/${workspaceId}`, '', 'repos:'];
  const services: string[] = [];
  for (const r of repos) {
    const id = deriveLainRepoId(r);
    if (r.local) {
      lines.push(`  - id: ${id}`, `    source: { type: workspace_dir, path: ${r.local} }`);
      services.push(`  - name: ${id}`, `    repo: ${id}`);
    } else {
      lines.push(
        `  # ${id}: clone ${r.uri} and set its local path to index it`,
        `  # - id: ${id}`,
        `  #   source: { type: workspace_dir, path: /path/to/${id} }`,
      );
    }
  }
  lines.push('', 'services:', ...services, '');
  return lines.join('\n');
}
