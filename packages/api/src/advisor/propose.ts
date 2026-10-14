// Constructor de propuestas (§5 del contrato). Tres familias, ninguna
// auto-aplicada: provides_graphql (el SDL en un consumer envenena el key
// space), env (URL base calculada en runtime) y bindings (validados uno a uno
// contra check_binding — sólo `valid: true` se presenta como aplicable, y el
// bindings_entry se usa verbatim).

import type { CheckBindingResponse, LainView } from '@parallax/shared/lain';
import type { LainAdapter } from '../lain-adapter/types.js';
import { decodeGlobalId, derivedKeyFromNodeName } from './correlate.js';
import type {
  AdvisorSignal,
  BindingCapability,
  BindingProposal,
  BindingVerdict,
  Correlation,
  EnvNoGap,
  EnvProposal,
  EnvUnmappedCorrelation,
  ProvidesGraphqlProposal,
  ServiceRef,
  UnresolvedItem,
} from './types.js';

export interface ProposeEngine {
  checkBinding: LainAdapter['checkBinding'];
}

const UNSUPPORTED_RE = /not supported|topic endpoints/i;

/** Señales de consumo: corroboran que el repo consume, no sólo que expone SDL. */
function consumptionSignals(signals: readonly AdvisorSignal[]): string[] {
  const files = new Set<string>();
  for (const s of signals) {
    if (
      s.kind === 'graphql_operations' ||
      s.kind === 'wrapped_fetcher' ||
      s.kind === 'codegen_config'
    ) {
      files.add(s.file);
    }
  }
  return [...files].sort();
}

/**
 * Criterio del §4: provides_graphql: false sólo para el servicio del repo que
 * tiene copias de SDL Y además emite señales de consumo (operaciones, wrappers
 * o codegen). Un repo que sólo expone un schema.graphql (p. ej. el provider
 * real) NO lo recibe.
 */
export function buildProvidesGraphqlProposals(
  signals: readonly AdvisorSignal[],
  services: readonly ServiceRef[],
): ProvidesGraphqlProposal[] {
  const byRepo = new Map<string, AdvisorSignal[]>();
  for (const s of signals) {
    const list = byRepo.get(s.repo) ?? [];
    list.push(s);
    byRepo.set(s.repo, list);
  }
  const proposals: ProvidesGraphqlProposal[] = [];
  for (const [repo, repoSignals] of [...byRepo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sdl = repoSignals.filter((s) => s.kind === 'sdl_copy');
    if (sdl.length === 0) continue;
    const consumption = consumptionSignals(repoSignals);
    if (consumption.length === 0) continue;
    const service = services.find((s) => s.repo === repo)?.service ?? repo;
    proposals.push({
      kind: 'provides_graphql',
      service,
      repo,
      provides_graphql: false,
      evidence: {
        sdlCopies: sdl.map((s) => s.file).sort(),
        consumption,
      },
    });
  }
  return proposals;
}

/**
 * Propuestas de env: sólo para variables que correlacionan con ítems
 * `env_unmapped` del motor — un hueco real, no una sospecha. La declaración
 * vive en el servicio al que la env apunta (el provider), como INVENTORY_URL
 * en el fixture de contratos.
 */
export function buildEnvProposals(
  signals: readonly AdvisorSignal[],
  correlation: Correlation,
  services: readonly ServiceRef[],
  scannedRepos: readonly string[],
): { proposals: EnvProposal[]; noGap: EnvNoGap[] } {
  const usage = new Map<string, { file: string; line: number }[]>();
  const repoOfVar = new Map<string, Set<string>>();
  for (const s of signals) {
    if (s.kind !== 'env_base_url' || !s.envVar) continue;
    const list = usage.get(s.envVar) ?? [];
    list.push({ file: s.file, line: s.line ?? 0 });
    usage.set(s.envVar, list);
    const repos = repoOfVar.get(s.envVar) ?? new Set<string>();
    repos.add(s.repo);
    repoOfVar.set(s.envVar, repos);
  }

  const byVar = new Map<string, EnvUnmappedCorrelation[]>();
  for (const item of correlation.envUnmapped) {
    if (!item.matchedVar) continue;
    const list = byVar.get(item.matchedVar) ?? [];
    list.push(item);
    byVar.set(item.matchedVar, list);
  }

  const proposals: EnvProposal[] = [];
  for (const [varName, items] of [...byVar.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const targets = new Set(
      items.map((i) => i.targetService).filter((t): t is string => Boolean(t)),
    );
    const target = [...targets].sort()[0] ?? '';
    const service = services.find((s) => s.service === target);
    proposals.push({
      kind: 'env',
      service: target,
      repo: service?.repo ?? items[0]?.repo ?? '',
      env: [varName],
      evidence: {
        usage: usage.get(varName) ?? [],
        unresolvedItems: items.length,
      },
    });
  }

  // Variables usadas como base URL que NO generan env_unmapped: ya declaradas
  // en la config vigente. Se reportan como "sin hueco" — no se propone nada.
  const noGap: EnvNoGap[] = [];
  for (const [varName, repos] of [...repoOfVar.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (byVar.has(varName)) continue;
    for (const repo of [...repos].sort()) {
      if (!scannedRepos.includes(repo)) continue;
      noGap.push({
        repo,
        envVar: varName,
        files: (usage.get(varName) ?? []).map((u) => u.file),
        note: 'sin env_unmapped en el motor: la variable ya cumple su función en la config vigente',
      });
    }
  }
  return { proposals, noGap };
}

export interface BindingCandidate {
  readonly consumer: { repo: string; path: string; symbol: string; key: string };
  readonly provider: { service: string; key: string };
  readonly consumerId: string;
  readonly consumerLine: number | undefined;
  /** Candidato descartado antes de tocar check_binding, con el motivo. */
  readonly blockReason?: string;
}

function serviceRepoMap(services: readonly ServiceRef[]): Map<string, string> {
  return new Map(services.map((s) => [s.service, s.repo]));
}

function providerRepoOf(
  groupProviders: readonly { repo?: string }[],
  service: string,
  services: readonly ServiceRef[],
): string | null {
  for (const p of groupProviders) {
    if (p.repo) return p.repo;
  }
  return serviceRepoMap(services).get(service) ?? null;
}

/**
 * Candidatos a binding: un nodo consumidor único (repo|path|símbolo) por
 * cada `graphql_no_op`, apuntando al servicio provider que queda tras
 * descontar los servicios con `provides_graphql: false` propuesto (sus copias
 * SDL dejan de ser proveedores cuando el operador aplica la propuesta).
 */
export function buildBindingCandidates(
  unresolved: readonly UnresolvedItem[],
  correlation: Correlation,
  providesGraphqlRepos: ReadonlySet<string>,
  services: readonly ServiceRef[],
): BindingCandidate[] {
  const groupsByKey = new Map(correlation.providerGroups.map((g) => [g.key, g.groups]));
  const seen = new Set<string>();
  const candidates: BindingCandidate[] = [];

  for (const item of unresolved) {
    if (item.reason !== 'graphql_no_op') continue;
    const decoded = decodeGlobalId(item.consumer.id);
    if (!decoded) continue;
    const key = derivedKeyFromNodeName(decoded.name);
    if (!key) continue;
    const dedupe = `${decoded.repo}|${decoded.path}|${decoded.name}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const baseCandidate = {
      consumer: {
        repo: decoded.repo,
        path: decoded.path,
        symbol: decoded.name,
        key,
      },
      consumerId: item.consumer.id,
      consumerLine: decoded.line,
    };

    const remaining = (groupsByKey.get(key) ?? []).filter((g) => {
      const owner = providerRepoOf(g.providers, g.service, services);
      return owner === null || !providesGraphqlRepos.has(owner);
    });
    if (remaining.length === 0) {
      candidates.push({
        ...baseCandidate,
        provider: { service: '', key },
        blockReason: 'sin provider de la llave tras descontar las copias SDL propuestas',
      });
      continue;
    }
    // Un solo provider restante, o el que ya tiene consumidores bindingados.
    const sorted = [...remaining].sort(
      (a, b) => b.boundConsumers - a.boundConsumers || a.service.localeCompare(b.service),
    );
    const chosen = sorted[0];
    if (!chosen) continue;
    if (sorted.length > 1 && chosen.boundConsumers === 0) {
      candidates.push({
        ...baseCandidate,
        provider: { service: chosen.service, key },
        blockReason: `proveedores ambiguos para ${key}: ${sorted.map((g) => g.service).join(', ')}`,
      });
      continue;
    }
    candidates.push({
      ...baseCandidate,
      provider: { service: chosen.service, key },
    });
  }
  return candidates;
}

function toVerdict(v: CheckBindingResponse): BindingVerdict {
  return {
    valid: v.valid,
    reasons: [...v.reasons],
    ...(v.method_match !== undefined ? { method_match: v.method_match } : {}),
    ...(typeof v.template_match === 'string' ? { template_match: v.template_match } : {}),
  };
}

export async function probeGraphqlBindingCapability(
  engine: ProposeEngine,
  snapshot: LainView,
  sample: { consumerId: string; service: string; key: string },
): Promise<BindingCapability> {
  try {
    const verdict = await engine.checkBinding({
      snapshot,
      consumer: sample.consumerId,
      endpoint: { service: sample.service, key: sample.key },
    });
    return {
      graphqlBindings: 'supported',
      detail: `check_binding responde veredicto para ${sample.key} (valid=${String(verdict.valid)})`,
      probe: { ok: true, verdict: toVerdict(verdict) },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : JSON.stringify(e);
    // El motor 0.9 responde "topic endpoints not supported in 0.9" a una
    // llave graphql: predates GraphQL bindings. Degradar con el motivo a la
    // vista; la propuesta de binding queda bloqueada, jamás presentada como
    // aplicable.
    const label = UNSUPPORTED_RE.test(message)
      ? 'el motor rechaza bindings GraphQL'
      : 'check_binding falló en el sondeo';
    return {
      graphqlBindings: 'unsupported',
      detail: `${label}: ${message.slice(0, 200)}`,
      probe: { ok: false, error: message.slice(0, 500) },
    };
  }
}

/**
 * Valida cada candidato contra check_binding. Sólo `valid: true` queda como
 * 'applicable' y conserva el bindings_entry verbatim del motor; el resto
 * queda 'rejected' con sus reasons. Si el motor no soporta bindings GraphQL,
 * todos quedan 'blocked' con el motivo de la sonda.
 */
export async function validateBindingProposals(
  engine: ProposeEngine,
  snapshot: LainView,
  candidates: readonly BindingCandidate[],
  capability: BindingCapability,
): Promise<BindingProposal[]> {
  const proposals: BindingProposal[] = [];
  for (const c of candidates) {
    const base = {
      kind: 'binding' as const,
      consumer: c.consumer,
      provider: c.provider,
      consumerId: c.consumerId,
      evidence: {
        ...(c.consumerLine !== undefined ? { consumerLine: c.consumerLine } : {}),
      },
    };
    if (c.blockReason) {
      proposals.push({ ...base, status: 'blocked', verdict: null, reason: c.blockReason });
      continue;
    }
    if (capability.graphqlBindings === 'unsupported') {
      proposals.push({
        ...base,
        status: 'blocked',
        verdict: null,
        reason: capability.detail,
      });
      continue;
    }
    let response: CheckBindingResponse;
    try {
      response = await engine.checkBinding({
        snapshot,
        consumer: c.consumerId,
        endpoint: { service: c.provider.service, key: c.provider.key },
      });
    } catch (e) {
      proposals.push({
        ...base,
        status: 'blocked',
        verdict: null,
        reason: `check_binding falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
      });
      continue;
    }
    const verdict = toVerdict(response);
    if (response.valid && typeof response.bindings_entry === 'string') {
      proposals.push({
        ...base,
        status: 'applicable',
        verdict,
        // Verbatim: el symbol/key del entry están calibrados para el matcher
        // del motor (repo + path + symbol). No se reescriben.
        bindingsEntry: response.bindings_entry,
      });
    } else {
      proposals.push({
        ...base,
        status: 'rejected',
        verdict,
        reason: response.reasons.length > 0 ? response.reasons.join(', ') : 'valid=false',
      });
    }
  }
  return proposals;
}
