export interface MutantSummary {
  file: string;
  mutator: string;
  line: number;
  status: string;
  description: string;
}

export interface AllowlistEntry {
  package: string;
  file: string;
  mutator: string;
  line: number;
  reason: string;
}

interface RawMutant {
  mutatorName?: string;
  status?: string;
  description?: string;
  location?: { start?: { line?: number } };
}

interface RawReport {
  files?: Record<string, { mutants?: RawMutant[] }>;
}

/** Aplana el reporte JSON de Stryker (schema mutation-testing-report). */
export function parseMutationReport(report: unknown): MutantSummary[] {
  const root = (report ?? {}) as RawReport;
  const out: MutantSummary[] = [];
  for (const [file, entry] of Object.entries(root.files ?? {})) {
    for (const m of entry.mutants ?? []) {
      out.push({
        file,
        mutator: m.mutatorName ?? '',
        line: m.location?.start?.line ?? 0,
        status: m.status ?? 'Unknown',
        description: m.description ?? '',
      });
    }
  }
  return out;
}

/** Survived/NoCoverage bloquean salvo que estén en el allowlist del paquete. */
export function gateDecision(
  mutants: readonly MutantSummary[],
  allowlist: readonly AllowlistEntry[],
  pkg: string,
): { blocked: MutantSummary[]; allowlisted: MutantSummary[] } {
  const isAllowed = (m: MutantSummary): boolean =>
    allowlist.some(
      (e) => e.package === pkg && e.file === m.file && e.mutator === m.mutator && e.line === m.line,
    );
  const survivors = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
  return {
    blocked: survivors.filter((m) => !isAllowed(m)),
    allowlisted: survivors.filter(isAllowed),
  };
}

/** Un allowlist sin justificación es una puerta falsa: se rechaza. */
export function validateAllowlist(entries: readonly AllowlistEntry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    if (!e.reason || e.reason.trim().length === 0) {
      problems.push(
        `allowlist entry without reason: ${e.package} ${e.file}:${e.line} ${e.mutator}`,
      );
    }
  }
  return problems;
}

/**
 * Sólo los paquetes con stryker.config.json se mutan; el resto se salta con
 * aviso en vez de reventar el gate (que es lo que hacía falta para que el PR
 * que introduce el gate pueda correr el gate).
 */
export function partitionRunnable(
  byPackage: ReadonlyMap<string, readonly string[]>,
  configured: ReadonlySet<string>,
): { runnable: Map<string, string[]>; skipped: string[] } {
  const runnable = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const [pkg, files] of byPackage) {
    if (configured.has(pkg)) runnable.set(pkg, [...files]);
    else skipped.push(pkg);
  }
  return { runnable, skipped };
}
