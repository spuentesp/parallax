export interface SeparationReport {
  implFiles: string[];
  heldoutFiles: string[];
  violation: boolean;
  reasons: string[];
}

export interface CommitChange {
  subject: string;
  files: readonly string[];
}

// El oráculo (test-heldout) vive fuera del alcance del agente que implementa:
// un mismo changeset no puede tocar implementación y oráculo a la vez.
const HELDOUT = /(^|\/)test-heldout\//;
const IMPL = /^packages\/[^/]+\/(src|test)\//;

export function evaluateDiff(files: readonly string[]): SeparationReport {
  const implFiles = files.filter((f) => IMPL.test(f) && !HELDOUT.test(f));
  const heldoutFiles = files.filter((f) => HELDOUT.test(f));
  return {
    implFiles,
    heldoutFiles,
    violation: implFiles.length > 0 && heldoutFiles.length > 0,
    reasons:
      implFiles.length > 0 && heldoutFiles.length > 0
        ? ['a changeset touches both implementation and test-heldout']
        : [],
  };
}

/**
 * Evalúa la serie de commits de un PR (no el diff agregado): el bootstrap de
 * la suite held-out es legal si implementación y oráculo viajan en commits
 * SEPARADOS, y todo commit que toca el oráculo declara `red-team` en el
 * asunto. Un commit mixto o un commit de oráculo sin prefijo violan.
 */
export function evaluateCommitSeries(commits: readonly CommitChange[]): SeparationReport {
  const implFiles = new Set<string>();
  const heldoutFiles = new Set<string>();
  const reasons: string[] = [];
  for (const commit of commits) {
    const report = evaluateDiff(commit.files);
    for (const f of report.implFiles) implFiles.add(f);
    for (const f of report.heldoutFiles) heldoutFiles.add(f);
    if (report.violation) {
      reasons.push(`commit "${commit.subject}" touches both implementation and test-heldout`);
    }
    if (report.heldoutFiles.length > 0 && !commit.subject.startsWith('red-team')) {
      reasons.push(
        `commit "${commit.subject}" touches test-heldout without a red-team subject prefix`,
      );
    }
  }
  return {
    implFiles: [...implFiles],
    heldoutFiles: [...heldoutFiles],
    violation: reasons.length > 0,
    reasons,
  };
}
