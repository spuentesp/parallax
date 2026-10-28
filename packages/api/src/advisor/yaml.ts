// Emisor de YAML a mano (no hay librería de YAML y no se agrega una). La
// salida tiene exactamente la forma del §6: services[] con provides_graphql
// y env por entrada, bindings[] con las entradas que devolvió check_binding
// — verbatim, sin reescribir. Aplicarla es un paso del operador.

import type {
  BindingCapability,
  BindingProposal,
  EnvProposal,
  ProvidesGraphqlProposal,
} from './types.js';

export interface AdvisorYamlInput {
  readonly providesGraphql: readonly ProvidesGraphqlProposal[];
  readonly env: readonly EnvProposal[];
  readonly bindings: readonly BindingProposal[];
  readonly capability: BindingCapability;
}

function quote(y: string): string {
  return `"${y.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Entrada `services:` del §5, en orden estable por servicio. */
export function emitServicesYaml(
  providesGraphql: readonly ProvidesGraphqlProposal[],
  env: readonly EnvProposal[],
): string[] {
  interface ServiceEntry {
    name: string;
    repo: string;
    providesGraphql: false | null;
    env: string[];
  }
  const entries = new Map<string, ServiceEntry>();
  const ensure = (name: string, repo: string): ServiceEntry => {
    const existing = entries.get(name);
    if (existing) return existing;
    const created: ServiceEntry = { name, repo, providesGraphql: null, env: [] };
    entries.set(name, created);
    return created;
  };
  for (const p of providesGraphql) ensure(p.service, p.repo).providesGraphql = false;
  for (const e of env) {
    const entry = ensure(e.service, e.repo);
    for (const v of e.env) {
      if (!entry.env.includes(v)) entry.env.push(v);
    }
  }

  const lines: string[] = [];
  for (const entry of [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    repo: ${entry.repo}`);
    if (entry.providesGraphql === false) lines.push('    provides_graphql: false');
    if (entry.env.length > 0) {
      lines.push(`    env: [${entry.env.map(quote).join(', ')}]`);
    }
  }
  return lines;
}

/** Bloque `bindings:` del §5: entradas verbatim del motor, en orden estable. */
export function emitBindingsYaml(bindings: readonly BindingProposal[]): string[] {
  const applicable = bindings
    .filter((b) => b.status === 'applicable' && typeof b.bindingsEntry === 'string')
    .sort(
      (a, b) =>
        a.consumer.repo.localeCompare(b.consumer.repo) ||
        a.consumer.path.localeCompare(b.consumer.path) ||
        a.consumer.symbol.localeCompare(b.consumer.symbol),
    );
  const lines: string[] = [];
  if (applicable.length === 0) return lines;
  lines.push('bindings:');
  for (const b of applicable) {
    // Verbatim: el entry del motor ya trae el guion inicial y la indentación.
    for (const line of (b.bindingsEntry ?? '').split('\n')) {
      lines.push(line);
    }
  }
  return lines;
}

export function emitAdvisorYaml(input: AdvisorYamlInput): string {
  const lines: string[] = [
    '# Propuestas del config advisor de Parallax — validadas contra el motor,',
    '# no aplicadas: copiar a repos.yaml y reindexar es un paso del operador.',
  ];
  lines.push('services:');
  lines.push(...emitServicesYaml(input.providesGraphql, input.env));

  const bindingLines = emitBindingsYaml(input.bindings);
  if (bindingLines.length > 0) {
    lines.push(...bindingLines);
  } else {
    const blocked = input.bindings.filter((b) => b.status === 'blocked').length;
    const rejected = input.bindings.filter((b) => b.status === 'rejected').length;
    lines.push('');
    if (input.capability.graphqlBindings === 'unsupported') {
      const detail = input.capability.detail.replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`# bindings: ${String(blocked)} candidatos GraphQL quedan bloqueados — ${detail}`);
      lines.push('# Requiere un motor con soporte de bindings GraphQL para emitirlos.');
    } else {
      lines.push(
        `# bindings: sin entradas aplicables (${String(blocked)} bloqueados, ${String(rejected)} rechazados por check_binding).`,
      );
    }
  }
  return lines.join('\n');
}
