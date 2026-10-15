// Despachante de herramientas de investigación (§14). Superficie SOLO lectura
// sobre LAIN: catálogo, detalle de servicio, contratos, impacto, evidencia y
// cobertura. Reglas:
//
//  - El modelo elige herramienta y argumentos; jamás la vista: el despachante
//    inyecta el snapshot fijado por el análisis en cada llamada.
//  - Nombre, schema y alcance (servicios/repos del workspace) se validan antes
//    de tocar LAIN. Una herramienta desconocida, argumentos inválidos o un
//    servicio fuera de alcance producen un error tipado; nunca se amplían
//    permisos para satisfacer al modelo.
//  - El presupuesto de llamadas se acaba aquí: una vez agotado, cada llamada
//    recibe budget_exhausted y no se ejecuta ninguna lectura adicional.
//  - Resultados grandes se recortan CON EL CORTE DECLARADO y con una llamada
//    de detalle más estrecha ofrecida; los unknowns no se esconden (INV 3).

import {
  GetContractArgs,
  GetCoverageArgs,
  GetServiceArgs,
  type LainView,
  ListContractsArgs,
  ListServicesArgs,
  ListUnresolvedArgs,
  ReadSourceArgs,
  ResolveEvidenceArgs,
  TraceImpactArgs,
} from '@parallax/shared/lain';
import { z } from 'zod';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { ToolCall, ToolSpec } from './nemotron.js';

export const DISPATCHER_TOOLS = [
  'list_services',
  'get_service',
  'list_contracts',
  'get_contract',
  'trace_impact',
  'resolve_evidence',
  'read_source',
  'list_unresolved',
  'get_coverage',
] as const;

export type DispatcherTool = (typeof DISPATCHER_TOOLS)[number];

export type DispatchErrorCode =
  | 'unknown_tool'
  | 'invalid_schema'
  | 'scope_violation'
  | 'budget_exhausted'
  | 'engine_error';

// Schemas del modelo SIN el campo `snapshot`: la vista la fija el análisis.
const ModelArgsSchemas = {
  list_services: ListServicesArgs.omit({ snapshot: true }),
  get_service: GetServiceArgs.omit({ snapshot: true }),
  list_contracts: ListContractsArgs.omit({ snapshot: true }),
  get_contract: GetContractArgs.omit({ snapshot: true }),
  trace_impact: TraceImpactArgs.omit({ snapshot: true }),
  resolve_evidence: ResolveEvidenceArgs.omit({ snapshot: true }),
  read_source: ReadSourceArgs.omit({ snapshot: true }),
  list_unresolved: ListUnresolvedArgs.omit({ snapshot: true }),
  get_coverage: GetCoverageArgs.omit({ snapshot: true }),
} as const;

const TOOL_DESCRIPTIONS: Record<DispatcherTool, string> = {
  list_services:
    'List the services of the fixed analysis view (catalog). Optional repo filter must belong to the workspace.',
  get_service:
    'Detail of one service: consumers, bindings and evidence anchors (site/caller with evidence ids).',
  list_contracts:
    'List contracts (endpoints) published in the view, optionally filtered by service or repo.',
  get_contract: 'Full detail of one contract by key (e.g. "http:GET /api/orders/{}").',
  trace_impact:
    'Impact paths from one endpoint/field/symbol in the fixed view. Returns paths with provenance confidence.',
  resolve_evidence:
    'Resolve evidence refs/ids previously delivered by the backend. A bad ref returns exists=false, never a guess.',
  read_source:
    'Read a bounded line range of one file in the view (repo+path+start+end). Use after resolve_evidence.',
  list_unresolved:
    'Unresolved inbound calls in the view — what the engine could NOT bind. Paginated; unknowns live here.',
  get_coverage:
    'What the view reviewed and what it could not: coverage.complete and scope (reviewed/unreviewed).',
};

export interface DispatchTruncation {
  originalChars: number;
  keptChars: number;
  omittedChars: number;
  nextCursor?: string;
  hint: string;
}

export interface DispatchOk {
  ok: true;
  tool: DispatcherTool;
  callId: string;
  data: unknown;
  truncated: DispatchTruncation | null;
  latencyMs: number;
}

export interface DispatchRejected {
  ok: false;
  tool: string;
  callId: string;
  code: DispatchErrorCode;
  message: string;
  latencyMs: number;
}

export type DispatchResult = DispatchOk | DispatchRejected;

export interface DispatcherConfig {
  lain: LainAdapter;
  view: LainView;
  maxToolCalls?: number;
  maxResultChars?: number;
}

const DEFAULT_MAX_TOOL_CALLS = 8;
const DEFAULT_MAX_RESULT_CHARS = 24_000;

export interface DispatcherBudgetUse {
  toolCallsUsed: number;
  maxToolCalls: number;
  exhausted: boolean;
}

export class LainDispatcher {
  private readonly lain: LainAdapter;
  private readonly view: LainView;
  private readonly maxToolCalls: number;
  private readonly maxResultChars: number;
  private toolCallsUsed = 0;
  // Evidencia entregada por el backend: el único conjunto que el modelo puede
  // citar (INV 1). Se alimenta de ids/refs que aparecen en resultados reales.
  private readonly delivered = new Set<string>();
  private catalog: { services: Set<string>; repos: Set<string> } | null = null;
  private catalogError: string | null = null;
  private readonly topologyEdges = new Map<string, { source: string; target: string }>();

  constructor(cfg: DispatcherConfig) {
    this.lain = cfg.lain;
    this.view = cfg.view;
    this.maxToolCalls = cfg.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.maxResultChars = cfg.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  }

  // Specs que ven el modelo: exactamente el conjunto de lectura, sin snapshot.
  // Esta lista es la prueba de que no se amplían permisos (P07).
  toolSpecs(): ToolSpec[] {
    return DISPATCHER_TOOLS.map((name) => ({
      type: 'function',
      function: {
        name,
        description: TOOL_DESCRIPTIONS[name],
        parameters: z.toJSONSchema(ModelArgsSchemas[name]),
      },
    }));
  }

  budgetUse(): DispatcherBudgetUse {
    return {
      toolCallsUsed: this.toolCallsUsed,
      maxToolCalls: this.maxToolCalls,
      exhausted: this.toolCallsUsed >= this.maxToolCalls,
    };
  }

  deliveredEvidence(): string[] {
    return [...this.delivered];
  }

  consumedEdges(): Array<{ source: string; target: string }> {
    return [...this.topologyEdges.values()];
  }

  async execute(call: ToolCall): Promise<DispatchResult> {
    const t0 = Date.now();
    const callId = call.id;
    const tool = call.function?.name ?? '';

    if (this.toolCallsUsed >= this.maxToolCalls) {
      return {
        ok: false,
        tool,
        callId,
        code: 'budget_exhausted',
        message: `research budget exhausted (${this.maxToolCalls} tool calls). Answer with what you have, declaring what remains unknown.`,
        latencyMs: Date.now() - t0,
      };
    }

    if (!isDispatcherTool(tool)) {
      return {
        ok: false,
        tool,
        callId,
        code: 'unknown_tool',
        message: `unknown tool "${tool}". Allowed tools: ${DISPATCHER_TOOLS.join(', ')}. Permissions are not widened on request.`,
        latencyMs: Date.now() - t0,
      };
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(call.function.arguments || '{}');
    } catch {
      return {
        ok: false,
        tool,
        callId,
        code: 'invalid_schema',
        message: `arguments for ${tool} are not valid JSON`,
        latencyMs: Date.now() - t0,
      };
    }

    const schema = ModelArgsSchemas[tool];
    const checked = schema.safeParse(parsedArgs);
    if (!checked.success) {
      const issues = checked.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return {
        ok: false,
        tool,
        callId,
        code: 'invalid_schema',
        message: `invalid arguments for ${tool}: ${issues}`,
        latencyMs: Date.now() - t0,
      };
    }
    const args = checked.data;

    const scopeError = await this.checkScope(tool, args);
    if (scopeError) {
      return {
        ok: false,
        tool,
        callId,
        code: 'scope_violation',
        message: scopeError,
        latencyMs: Date.now() - t0,
      };
    }

    // La vista la inyecta SIEMPRE el backend: el modelo no la elige.
    this.toolCallsUsed++;

    try {
      const data = await this.dispatchToLain(tool, args);
      this.harvest(tool, data);
      const { value, truncated } = this.truncate(data, tool);
      return {
        ok: true,
        tool,
        callId,
        data: value,
        truncated,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        tool,
        callId,
        code: 'engine_error',
        message: `LAIN ${tool} failed: ${message}`,
        latencyMs: Date.now() - t0,
      };
    }
  }

  // Cada llamada recibe el snapshot de la vista inyectado aquí: los args del
  // modelo jamás lo traen (el schema del modelo ni lo expone).
  private async dispatchToLain(
    tool: DispatcherTool,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const snapshot = this.view;
    switch (tool) {
      case 'list_services':
        return this.lain.listServices({ ...(args as object), snapshot } as never);
      case 'get_service':
        return this.lain.getService({ ...(args as object), snapshot } as never);
      case 'list_contracts':
        return this.lain.listContracts({ ...(args as object), snapshot } as never);
      case 'get_contract':
        return this.lain.getContract({ ...(args as object), snapshot } as never);
      case 'trace_impact':
        return this.lain.traceImpact({ ...(args as object), snapshot } as never);
      case 'resolve_evidence':
        return this.lain.resolveEvidence({ ...(args as object), snapshot } as never);
      case 'read_source':
        return this.lain.readSource({ ...(args as object), snapshot } as never);
      case 'list_unresolved':
        return this.lain.listUnresolved({ ...(args as object), snapshot } as never);
      case 'get_coverage':
        return this.lain.getCoverage({ ...(args as object), snapshot } as never);
    }
  }

  // Alcance: servicios y repos deben pertenecer al catálogo de la vista. El
  // catálogo se obtiene una vez; si falla, el catálogo queda vacío y TODO se
  // rechaza (fail-closed: un fallo de lectura nunca se convierte en permiso
  // abierto), con el motivo a la vista (INV 3).
  private async checkScope(
    tool: DispatcherTool,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    const needsCatalog =
      'service' in args ||
      'repo' in args ||
      tool === 'resolve_evidence' ||
      tool === 'list_services';
    if (!needsCatalog) return null;
    if (!this.catalog) await this.loadCatalog();
    const catalog = this.catalog;
    const catalogNote = this.catalogError ? ` (catalog unavailable: ${this.catalogError})` : '';

    const service = args.service;
    if (typeof service === 'string' && catalog && !catalog.services.has(service)) {
      return `service "${service}" is outside the analyzed view. Known services: ${[...catalog.services].join(', ')}${catalogNote}`;
    }
    const repo = args.repo;
    if (typeof repo === 'string' && catalog && !catalog.repos.has(repo)) {
      return `repo "${repo}" is outside the analyzed view. Known repos: ${[...catalog.repos].join(', ')}${catalogNote}`;
    }
    if (tool === 'resolve_evidence') {
      const refs = Array.isArray(args.refs) ? (args.refs as string[]) : [];
      for (const ref of refs) {
        const repoOfRef = repoFromRef(ref);
        if (repoOfRef && catalog && !catalog.repos.has(repoOfRef) && !this.delivered.has(ref)) {
          return `evidence ref "${ref}" points to repo "${repoOfRef}" outside the analyzed view`;
        }
      }
    }
    return null;
  }

  private async loadCatalog(): Promise<void> {
    try {
      const list = await this.lain.listServices({ snapshot: this.view });
      const services = new Set<string>();
      const repos = new Set<string>();
      for (const item of list.items) {
        services.add(item.service);
        repos.add(item.repo);
      }
      for (const reviewed of list.scope?.reviewed ?? []) {
        if (typeof reviewed?.repo === 'string') repos.add(reviewed.repo);
      }
      this.catalog = { services, repos };
      // El arranque del catálogo no consume presupuesto del modelo: es la vista
      // fijada por el análisis, no una llamada de investigación.
      this.catalogError = null;
    } catch (e) {
      this.catalogError = e instanceof Error ? e.message : String(e);
      this.catalog = { services: new Set(), repos: new Set() };
    }
  }

  // Recoge los ids de evidencia que el backend ENTREGÓ (INV 1): anclas de
  // get_service y refs resueltas por resolve_evidence. Sólo estos ids pueden
  // aparecer citados en la respuesta final.
  private harvest(tool: DispatcherTool, data: unknown): void {
    if (tool === 'resolve_evidence' && data && typeof data === 'object') {
      const items = (
        data as { items?: Array<{ exists?: boolean; ref?: string; node?: { id?: string } }> }
      ).items;
      for (const item of items ?? []) {
        if (item?.exists === true) {
          if (typeof item.ref === 'string') this.delivered.add(item.ref);
          if (typeof item.node?.id === 'string') this.delivered.add(item.node.id);
        }
      }
    }
    walkEvidenceIds(data, (id) => this.delivered.add(id));
    if (tool === 'get_service' && data && typeof data === 'object') {
      const svc = data as { service?: string; consumers?: Array<{ service?: string }> };
      for (const consumer of svc.consumers ?? []) {
        if (consumer.service && svc.service) {
          this.topologyEdges.set(`${consumer.service}->${svc.service}`, {
            source: consumer.service,
            target: svc.service,
          });
        }
      }
    }
  }

  // Reducción con corte declarado (§14): el modelo ve el preview más la
  // declaración del recorte y una llamada de detalle ofrecida.
  private truncate(
    data: unknown,
    tool: DispatcherTool,
  ): { value: unknown; truncated: DispatchTruncation | null } {
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch {
      json = String(data);
    }
    if (json.length <= this.maxResultChars) return { value: data, truncated: null };
    const nextCursor =
      data && typeof data === 'object' && typeof (data as { cursor?: unknown }).cursor === 'string'
        ? (data as { cursor: string }).cursor
        : undefined;
    const kept = json.slice(0, this.maxResultChars);
    const cut: DispatchTruncation = {
      originalChars: json.length,
      keptChars: kept.length,
      omittedChars: json.length - kept.length,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      hint: `result of ${tool} was reduced to fit the context; the cut is declared here. For details call a narrower tool (get_contract, resolve_evidence, read_source with a smaller range) or paginate${nextCursor ? ` with cursor ${nextCursor}` : ''}. Unknowns in the omitted section are NOT resolved — do not guess them.`,
    };
    let preview: unknown;
    try {
      preview = JSON.parse(`${kept.slice(0, Math.max(0, kept.lastIndexOf(',')))}}`);
    } catch {
      preview = kept;
    }
    return { value: { truncated_preview: preview, cut }, truncated: cut };
  }
}

function isDispatcherTool(name: string): name is DispatcherTool {
  return (DISPATCHER_TOOLS as readonly string[]).includes(name);
}

// Repo de una ref: GlobalId `repo:Node:...` o EvidenceRef `repo@sha:path:line`.
function repoFromRef(ref: string): string | null {
  if (ref.includes('@')) return ref.split('@')[0] || null;
  const colon = ref.indexOf(':');
  return colon > 0 ? ref.slice(0, colon) : null;
}

// Camina el JSON buscando anclas con `id` (nodos con node_type o con repo/path):
// son ids de evidencia que el motor entregó en ESTA vista.
function walkEvidenceIds(data: unknown, onId: (id: string) => void, depth = 0): void {
  if (depth > 8 || data == null) return;
  if (Array.isArray(data)) {
    for (const item of data) walkEvidenceIds(item, onId, depth + 1);
    return;
  }
  if (typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.id === 'string' &&
    (obj.node_type != null || obj.repo != null || obj.path != null)
  ) {
    onId(obj.id);
  }
  for (const value of Object.values(obj)) {
    if (value != null && typeof value === 'object') walkEvidenceIds(value, onId, depth + 1);
  }
}

export function createDispatcher(cfg: DispatcherConfig): LainDispatcher {
  return new LainDispatcher(cfg);
}
