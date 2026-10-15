export interface SeparationReport {
  implFiles: string[];
  heldoutFiles: string[];
  violation: boolean;
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
  };
}
