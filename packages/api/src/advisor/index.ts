// Orquestador del config advisor. Flujo completo, en orden:
//
//   1. escanear los checkouts (señales del §4, sin respetar .gitignore)
//   2. correlacionar con list_unresolved + list_contracts (paginados al
//      agotamiento — una sola página es un error)
//   3. construir propuestas (§5) y validar cada binding contra check_binding
//   4. emitir el YAML del §6 listo para que el operador lo aplique
//
// Nada de esto escribe configuración ni internos de .lain: la salida es
// propuesta + evidencia.

import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from '../lain-adapter/types.js';
import {
  type CorrelationEngine,
  correlate,
  decodeGlobalId,
  fetchAllContracts,
  fetchAllUnresolved,
} from './correlate.js';
import {
  buildBindingCandidates,
  buildEnvProposals,
  buildProvidesGraphqlProposals,
  probeGraphqlBindingCapability,
  validateBindingProposals,
} from './propose.js';
import { scanRepo } from './scan.js';
import type {
  AdvisorRepoInput,
  AdvisorReport,
  AdvisorSignal,
  BindingCapability,
  SignalKind,
} from './types.js';
import { emitAdvisorYaml } from './yaml.js';

export interface AdvisorEngine extends CorrelationEngine {
  listServices: LainAdapter['listServices'];
  checkBinding: LainAdapter['checkBinding'];
}

const EMPTY_COUNTS: Record<SignalKind, number> = {
  graphql_operations: 0,
  fragment_only_document: 0,
  sdl_copy: 0,
  env_base_url: 0,
  wrapped_fetcher: 0,
  codegen_config: 0,
  gitignored_generated: 0,
};

function countByKind(signals: readonly AdvisorSignal[]): Record<SignalKind, number> {
  const counts: Record<SignalKind, number> = { ...EMPTY_COUNTS };
  for (const s of signals) counts[s.kind]++;
  return counts;
}

export async function runAdvisor(
  engine: AdvisorEngine,
  repos: readonly AdvisorRepoInput[],
  snapshot: LainView = 'live',
): Promise<AdvisorReport> {
  // 1. Señales del filesystem.
  const findings: AdvisorSignal[] = [];
  for (const repo of repos) {
    findings.push(...scanRepo(repo));
  }
  const signalsByKind = countByKind(findings);

  // 2. Motor: servicios + unresolved/contracts paginados al agotamiento.
  const servicesResp = await engine.listServices({ snapshot });
  const services = servicesResp.items.map((s) => ({ service: s.service, repo: s.repo }));

  const unresolved = [];
  for (const repo of repos) {
    unresolved.push(...(await fetchAllUnresolved(engine, { snapshot, repo: repo.id })));
  }
  const contracts = await fetchAllContracts(engine, { snapshot });
  const correlation = correlate(findings, unresolved, contracts);

  // 3a. provides_graphql: SDL copiado + señales de consumo en el mismo repo.
  const providesGraphql = buildProvidesGraphqlProposals(findings, services);
  const providesGraphqlRepos = new Set(providesGraphql.map((p) => p.repo));

  // 3b. env: sólo huecos reales (env_unmapped correlacionado).
  const { proposals: env, noGap: envNoGap } = buildEnvProposals(
    findings,
    correlation,
    services,
    repos.map((r) => r.id),
  );

  // 3c. bindings: sonda de capacidad y validación una a una.
  const candidates = buildBindingCandidates(
    unresolved,
    correlation,
    providesGraphqlRepos,
    services,
  );
  // Sonda de capacidad: la pregunta es si el motor acepta llaves graphql: en
  // check_binding, no si este vínculo en particular es correcto — se sondea
  // aunque todos los candidatos estén bloqueados por otra razón.
  const probeTarget =
    candidates.find((c) => !c.blockReason && c.provider.service !== '') ??
    candidates.find((c) => c.provider.service !== '') ??
    (() => {
      const anyItem = unresolved.find(
        (i) => i.reason === 'graphql_no_op' && decodeGlobalId(i.consumer.id) !== null,
      );
      const anyGroup = correlation.providerGroups[0]?.groups[0];
      if (!anyItem || !anyGroup) return null;
      return {
        consumerId: anyItem.consumer.id,
        provider: { service: anyGroup.service, key: anyGroup.key },
      };
    })();
  let capability: BindingCapability;
  if (probeTarget) {
    capability = await probeGraphqlBindingCapability(engine, snapshot, {
      consumerId: probeTarget.consumerId,
      service: probeTarget.provider.service,
      key: probeTarget.provider.key,
    });
  } else {
    capability = {
      graphqlBindings: 'unknown' as const,
      detail: 'sin candidatos GraphQL que sondear',
      probe: null,
    };
  }
  const bindings =
    capability.graphqlBindings === 'supported'
      ? await validateBindingProposals(engine, snapshot, candidates, capability)
      : // Sin soporte de bindings GraphQL no se valida nada contra
        // check_binding y nada se presenta como aplicable: cada candidato
        // queda bloqueado con el motivo a la vista.
        candidates.map((c) => ({
          kind: 'binding' as const,
          consumer: c.consumer,
          provider: c.provider,
          consumerId: c.consumerId,
          evidence: {
            ...(c.consumerLine !== undefined ? { consumerLine: c.consumerLine } : {}),
          },
          status: 'blocked' as const,
          verdict: null,
          reason: c.blockReason ?? capability.detail,
        }));

  // 4. YAML del §6, listo para aplicar (el operador decide cuándo).
  const yaml = emitAdvisorYaml({
    providesGraphql,
    env,
    bindings,
    capability,
  });

  const notes: string[] = [
    `señales escaneadas en ${String(repos.length)} repos sin respetar .gitignore`,
    `list_unresolved agotado: ${String(correlation.unresolvedTotal)} ítems (graphql_no_op=${String(correlation.graphqlNoOp.total)}, correlacionados=${String(correlation.graphqlNoOp.matchedToSignals)})`,
    `${String(correlation.duplicatedKeys.length)} llaves GraphQL con más de un grupo de proveedores (disparador de graphql_no_op)`,
    capability.detail,
  ];
  if (envNoGap.length > 0) {
    notes.push(
      `env ya declaradas sin hueco: ${envNoGap.map((n) => `${n.repo}:${n.envVar}`).join(', ')}`,
    );
  }

  return {
    snapshot,
    capability,
    findings,
    signalsByKind,
    correlation,
    proposals: {
      providesGraphql,
      env,
      envNoGap,
      bindings,
      applicableBindings: bindings.filter((b) => b.status === 'applicable').length,
    },
    yaml,
    notes,
  };
}

export { correlate, decodeGlobalId, derivedKeyFromNodeName } from './correlate.js';
export { parseGraphqlDocument, scanRepo } from './scan.js';
export type { AdvisorRepoInput, AdvisorReport, AdvisorSignal, SignalKind } from './types.js';
export { emitAdvisorYaml, emitBindingsYaml, emitServicesYaml } from './yaml.js';
