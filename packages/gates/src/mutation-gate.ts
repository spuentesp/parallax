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
  description: string;
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

const matchesEntry = (m: MutantSummary, e: AllowlistEntry, pkg: string): boolean =>
  e.package === pkg &&
  e.file === m.file &&
  e.mutator === m.mutator &&
  e.description === m.description;

/** Survived/NoCoverage bloquean salvo que estén en el allowlist del paquete. */
export function gateDecision(
  mutants: readonly MutantSummary[],
  allowlist: readonly AllowlistEntry[],
  pkg: string,
): { blocked: MutantSummary[]; allowlisted: MutantSummary[] } {
  const isAllowed = (m: MutantSummary): boolean => allowlist.some((e) => matchesEntry(m, e, pkg));
  const survivors = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
  return {
    blocked: survivors.filter((m) => !isAllowed(m)),
    allowlisted: survivors.filter(isAllowed),
  };
}

/**
 * Entradas del allowlist que no emparejaron con NINGÚN mutante de la corrida:
 * quedaron obsoletas (el código cambió o el mutante desapareció) y se avisan
 * para que un humano las retire o reescriba.
 */
export function findStaleEntries(
  allowlist: readonly AllowlistEntry[],
  mutants: readonly MutantSummary[],
  pkg: string,
): AllowlistEntry[] {
  return allowlist.filter(
    (e) => e.package === pkg && !mutants.some((m) => matchesEntry(m, e, pkg)),
  );
}

export type AllowlistParse = { ok: true; entries: AllowlistEntry[] } | { ok: false; error: string };

/** Parseo del archivo de allowlist: error limpio en vez de excepción cruda. */
export function parseAllowlistFile(content: string): AllowlistParse {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `mutation-allowlist.json is not valid JSON: ${String(e)}` };
  }
  const entries = (data as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return { ok: false, error: 'mutation-allowlist.json must contain an "entries" array' };
  }
  return { ok: true, entries: entries as AllowlistEntry[] };
}

/** Un allowlist sin justificación es una puerta falsa: se rechaza. */
export function validateAllowlist(entries: readonly AllowlistEntry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    if (!e.reason || e.reason.trim().length === 0) {
      problems.push(`allowlist entry without reason: ${e.package} ${e.file} ${e.mutator}`);
    }
    if (!e.description || e.description.trim().length === 0) {
      problems.push(`allowlist entry without description: ${e.package} ${e.file} ${e.mutator}`);
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
