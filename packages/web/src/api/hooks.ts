import type {
  AssessmentReport,
  AssessmentRequest,
  AssessmentSummary,
} from '@parallax/shared/domain';
import type {
  MapMeta,
  MapViewResponse,
  NodeDetail,
  OrgGraphFilters,
  OrgNode,
} from '@parallax/shared/org-map';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClient, ApiEndpointNotImplemented } from './client.js';
import { currentToken } from './token.js';

// El token se lee en cada petición (ver token.ts): entrar, salir o cambiar de
// sesión no exige recargar la página.
const client = new ApiClient({ token: currentToken });

/** Quién es el portador del token y si su sesión es de sólo lectura. */
export interface Whoami {
  orgId: string;
  scopes: string[];
  readOnly: boolean;
}

export function useWhoami(enabled = true) {
  return useQuery({
    queryKey: ['whoami'],
    queryFn: () => client.get<Whoami>('/api/whoami'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => client.get<{ orgs: unknown[] }>('/api/orgs'),
  });
}

export function useAssessmentList(orgId?: string) {
  return useQuery({
    queryKey: ['assessments', orgId ?? 'all'],
    queryFn: () =>
      client.get<{ assessments: AssessmentSummary[] }>(
        orgId ? `/api/assessments?orgId=${encodeURIComponent(orgId)}` : '/api/assessments',
      ),
  });
}

export function useAssessment(id: string | null) {
  return useQuery({
    queryKey: ['assessment', id],
    queryFn: () => client.get<{ assessment: AssessmentReport }>(`/api/assessments/${id}`),
    enabled: id != null,
    retry: (count, err) => {
      if (err instanceof ApiEndpointNotImplemented) return false;
      return count < 2;
    },
  });
}

export function useCreateAssessment() {
  return useMutation({
    mutationFn: (body: AssessmentRequest) =>
      client.post<{ assessment: AssessmentReport; created: boolean }>('/api/assessments', body),
  });
}

// ── PRs abiertos y CI automática (lectura del selector, configuración por workspace) ──

export interface OpenPrItem {
  number: number;
  url: string;
  title: string;
  author: string | null;
  draft: boolean;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  updatedAt: string;
  repo: string;
}

export interface OpenPrsResponse {
  prs: OpenPrItem[];
  skipped: Array<{ repo: string; reason: string }>;
  errors: Array<{ repo: string; code: string; message: string }>;
  truncated: string[];
}

export function useOpenPrs(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['open-prs', workspaceId],
    queryFn: () => client.get<OpenPrsResponse>(`/api/workspaces/${workspaceId}/prs`),
    enabled: workspaceId != null,
  });
}

/** Evalúa un PR abierto: la API resuelve la URL a SHAs (sólo lectura) y crea la evaluación. */
export function useEvaluatePr() {
  return useMutation({
    mutationFn: (args: { prUrl: string; orgId: string }) =>
      client.post<{ assessment: { id: string }; created: boolean }>('/api/assessments', args),
  });
}

export interface WorkspaceCiSettings {
  mode: 'off' | 'on-open-and-update';
  baseBranch: string | null;
  reportComments: boolean;
}

export function useCiSettings(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['ci-settings', workspaceId],
    queryFn: () => client.get<WorkspaceCiSettings>(`/api/workspaces/${workspaceId}/ci`),
    enabled: workspaceId != null,
  });
}

export function useSaveCiSettings(workspaceId: string) {
  return useMutation({
    mutationFn: (settings: WorkspaceCiSettings) =>
      client.put<WorkspaceCiSettings>(`/api/workspaces/${workspaceId}/ci`, settings),
  });
}

// ── Evaluaciones (§13: el informe persistido) ───────────────────────────────

// El tipo AssessmentRequest viene del contrato compartido
// (@parallax/shared/domain) — importado arriba, no se redeclara aquí.

// ── Workspaces (control plane) ──────────────────────────────────────────────

export interface WorkspaceRepo {
  id: string;
  uri: string;
  sha: string | null;
  local: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  lainUrl: string | null;
  repos: WorkspaceRepo[];
  repoCount: number;
}

export interface TopologyNode {
  id: string;
  label: string;
  kind: 'repo' | 'service' | 'endpoint';
  parent: string | null;
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'contains' | 'consumes' | 'servedBy';
  meta?: Record<string, unknown>;
}

export interface TopologyFilters {
  kind?: string | undefined;
  service?: string | undefined;
  binding?: 'static' | 'heuristic' | undefined;
  minConfidence?: number | undefined;
}

export interface TopologyResponse {
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] } | null;
  stats: {
    repos: number;
    services: number;
    endpoints: number;
    dependencies: number;
    byKind: Record<string, number>;
  } | null;
  source: 'lain' | 'unconfigured' | 'error' | 'none';
  error?: string;
  lainUrl?: string;
  workspace?: { id: string; name: string; repoCount: number };
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => client.get<{ workspaces: Workspace[] }>('/api/workspaces'),
  });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: ['workspace', id],
    queryFn: () => client.get<{ workspace: Workspace | null }>(`/api/workspaces/${id}`),
    enabled: id != null,
  });
}

export function useWorkspaceTopology(id: string | undefined, filters: TopologyFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.kind) qs.set('kind', filters.kind);
  if (filters.service) qs.set('service', filters.service);
  if (filters.binding) qs.set('binding', filters.binding);
  if (filters.minConfidence !== undefined) qs.set('minConfidence', String(filters.minConfidence));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return useQuery({
    queryKey: ['workspace-topology', id, filters],
    queryFn: () => client.get<TopologyResponse>(`/api/workspaces/${id}/topology${suffix}`),
    enabled: id != null,
  });
}

// ── Code graph (query_graph: repo → archivo → símbolo, expandible) ──────────

export type CodeNodeKind = 'container' | 'symbol' | 'route' | 'schema' | 'other';

export interface CodeGraphNode {
  id: string;
  name: string;
  type: string;
  kind: CodeNodeKind;
}

export interface CodeGraphRepoRoot {
  repo: string;
  nodes: CodeGraphNode[];
  truncated: boolean;
  /** Carpetas de la cima que se dejaron fuera por ser ruido. */
  hidden?: number;
  error?: string;
}

export interface GraphRootResponse {
  graph: { repos: CodeGraphRepoRoot[] } | null;
  source: 'lain' | 'unconfigured' | 'error' | 'none';
  error?: string;
  lainUrl?: string;
  workspace?: { id: string; name: string; repoCount: number };
}

export interface CodeGraphCommGroup {
  edge: string;
  nodes: CodeGraphNode[];
  error?: string;
}

export interface CodeGraphChildrenResponse {
  node?: { repo: string; type: string; name: string };
  children?: CodeGraphNode[];
  childrenTruncated?: boolean;
  /** Hijos que se dejaron fuera por ser ruido (tests, historias, ocultos). */
  childrenHidden?: number;
  communications?: CodeGraphCommGroup[];
  hasCommunication?: boolean;
  source?: 'lain' | 'unconfigured' | 'error';
  error?: string;
}

export interface GraphSnippetResponse {
  snippet: {
    symbol: string;
    repo: string;
    path: string | null;
    text: string | null;
    error?: string;
  } | null;
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
}

export function codeNodeKey(repo: string, type: string, name: string): string {
  return `${repo}|${type}|${name}`;
}

// La expansión es imperativa (no un hook por fila): cada nodo abierto tiene
// su propia caché en el árbol y varias filas pueden estar expandidas a la vez.
export function fetchGraphChildren(
  workspaceId: string,
  ref: { repo: string; type: string; name: string },
): Promise<CodeGraphChildrenResponse> {
  const qs = new URLSearchParams({ repo: ref.repo, type: ref.type, name: ref.name });
  return client.get<CodeGraphChildrenResponse>(
    `/api/workspaces/${workspaceId}/graph/children?${qs}`,
  );
}

/** Raíz de código de UN repo (el mapa abre el código repo a repo). */
export function fetchGraphRoot(workspaceId: string, repo: string): Promise<GraphRootResponse> {
  const qs = new URLSearchParams({ repo });
  return client.get<GraphRootResponse>(`/api/workspaces/${workspaceId}/graph?${qs}`);
}

/** Fuente de un símbolo (explain_symbol) o de un archivo por su path (get_code_snippet). */
export function fetchGraphSnippet(
  workspaceId: string,
  repo: string,
  target: string | { path: string },
): Promise<GraphSnippetResponse> {
  const qs = new URLSearchParams(
    typeof target === 'string' ? { repo, symbol: target } : { repo, path: target.path },
  );
  return client.get<GraphSnippetResponse>(`/api/workspaces/${workspaceId}/graph/snippet?${qs}`);
}

export interface SymbolContextDto {
  symbol: string;
  repo: string;
  path: string | null;
  type: string | null;
  calls: string[];
  calledBy: string[];
  anchorScore?: number;
  rawText?: string;
  error?: string;
}

export function useSymbolContext(
  workspaceId: string | undefined,
  repo: string | undefined,
  symbol: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['symbol-context', workspaceId, repo, symbol],
    queryFn: () => {
      const qs = new URLSearchParams({ repo: repo ?? '', symbol: symbol ?? '' });
      return client.get<{
        context: SymbolContextDto | null;
        source: 'lain' | 'error' | 'unconfigured';
      }>(`/api/workspaces/${workspaceId}/graph/symbol-context?${qs}`);
    },
    enabled: enabled && Boolean(workspaceId && repo && symbol),
    staleTime: 5 * 60_000,
  });
}

export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      lainUrl?: string;
      repos?: Array<{ uri: string; sha?: string; local?: string }>;
    }) => {
      const { repos, ...ws } = body;
      return client.post<{ workspace: Workspace }>('/api/workspaces', ws).then(async (res) => {
        for (const repo of repos ?? []) {
          if (repo.uri.trim()) {
            await client.post(`/api/workspaces/${res.workspace.id}/repos`, repo);
          }
        }
        return res;
      });
    },
  });
}

// ── Configuración del workspace: repos, servidor LAIN, estado de indexado ──

export type RepoIndexState = 'indexed' | 'unreviewed' | 'not_in_lain';

export interface RepoStatus {
  id: string;
  uri: string;
  sha: string | null;
  local: string | null;
  lainRepoId: string;
  state: RepoIndexState;
  commit?: string;
  dirty?: boolean;
}

export interface RepoStatusResponse {
  source: 'lain' | 'unconfigured' | 'error' | 'none';
  error?: string;
  repos: RepoStatus[];
  untracked: Array<{ repo: string; commit: string }>;
}

export function useRepoStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['repo-status', workspaceId],
    queryFn: () => client.get<RepoStatusResponse>(`/api/workspaces/${workspaceId}/repos/status`),
    enabled: workspaceId != null,
  });
}

/** Tras cualquier cambio de configuración: lo que se muestra y el mapa se rehacen. */
function useInvalidateWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      'workspace',
      'workspaces',
      'repo-status',
      'org-map',
      'org-map-node',
      'org-map-search',
      'lain-config',
      'workspace-topology',
      'workspace-graph',
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
    void qc.invalidateQueries({ queryKey: ['workspace', workspaceId] });
  };
}

export function useAddRepo(workspaceId: string) {
  const done = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (repo: { uri: string; sha?: string; local?: string }) =>
      client.post(`/api/workspaces/${workspaceId}/repos`, repo),
    onSuccess: done,
  });
}

export function useRemoveRepo(workspaceId: string) {
  const done = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (repoId: string) => client.del(`/api/workspaces/${workspaceId}/repos/${repoId}`),
    onSuccess: done,
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const done = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (patch: { name?: string; description?: string | null; lainUrl?: string | null }) =>
      client.patch(`/api/workspaces/${workspaceId}`, patch),
    onSuccess: done,
  });
}

export function useDeleteWorkspace(workspaceId: string) {
  const done = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: () => client.del(`/api/workspaces/${workspaceId}`),
    onSuccess: done,
  });
}

export function useLainConfig(workspaceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['lain-config', workspaceId],
    queryFn: () =>
      client.get<{ config: string | null }>(`/api/workspaces/${workspaceId}/lain-config`),
    enabled: workspaceId != null && enabled,
  });
}

// ── Evidence (resolve_evidence + read_source contra la misma vista) ─────────

export interface EvidenceItemShape {
  exists: boolean;
  ref: string;
  reason?: string | undefined;
  snippet?: string | null | undefined;
  node?:
    | {
        id: string;
        name?: string | undefined;
        node_type: string;
        ref: { commit: string; id: string; line: number; path: string; repo: string };
      }
    | undefined;
  source?:
    | {
        text: string;
        path: string;
        start: number;
        end: number;
        commit: string;
        total_lines: number;
        error?: string | undefined;
      }
    | null
    | undefined;
}

export function useEvidence() {
  return useMutation({
    mutationFn: (vars: { workspaceId: string; refs: string[]; contextLines?: number }) =>
      client.post<{ items: EvidenceItemShape[]; source: string; error?: string }>(
        `/api/workspaces/${vars.workspaceId}/evidence`,
        {
          refs: vars.refs,
          ...(vars.contextLines !== undefined ? { contextLines: vars.contextLines } : {}),
        },
      ),
  });
}

// ── Mapa de la organización (grafo unificado, carga perezosa, con caché) ────
//
// El servidor devuelve sólo lo visible para el conjunto de nodos expandidos; el
// cliente pide otra vista al abrir/cerrar un nodo. keepPreviousData evita el
// parpadeo mientras llega la nueva proyección.

export interface MapViewParams {
  expand: readonly string[];
  filters: OrgGraphFilters;
  focus?: string | undefined;
  hops?: number | undefined;
  limits?: Readonly<Record<string, number>>;
  pin?: readonly string[];
}

export function useOrgMap(workspaceId: string | undefined, params: MapViewParams) {
  const expand = [...params.expand].sort();
  return useQuery({
    queryKey: [
      'org-map',
      workspaceId,
      expand,
      params.filters,
      params.focus,
      params.hops,
      params.limits,
      params.pin,
    ],
    queryFn: () =>
      client.post<MapViewResponse>(`/api/workspaces/${workspaceId}/map/view`, {
        expand,
        filters: params.filters,
        ...(params.focus ? { focus: params.focus, hops: params.hops ?? 1 } : {}),
        ...(params.limits ? { limits: params.limits } : {}),
        ...(params.pin && params.pin.length > 0 ? { pin: params.pin } : {}),
      }),
    enabled: workspaceId != null,
    placeholderData: keepPreviousData,
    // La caché del servidor decide la frescura; el cliente sólo vuelve a pedir
    // mientras el servidor dice que está reconstruyendo, para que "refreshing"
    // se resuelva solo en vez de quedarse pegado.
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.meta?.refreshing ? 3_000 : false),
  });
}

export function useMapNode(workspaceId: string | undefined, nodeId: string | null) {
  return useQuery({
    queryKey: ['org-map-node', workspaceId, nodeId],
    queryFn: () => {
      const qs = new URLSearchParams({ id: nodeId ?? '' });
      return client.get<{ detail: NodeDetail | null; meta: MapMeta }>(
        `/api/workspaces/${workspaceId}/map/node?${qs}`,
      );
    },
    enabled: workspaceId != null && nodeId != null,
    staleTime: 60_000,
  });
}

export function useMapSearch(workspaceId: string | undefined, q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['org-map-search', workspaceId, term],
    queryFn: () => {
      const qs = new URLSearchParams({ q: term });
      return client.get<{ results: OrgNode[]; meta: MapMeta }>(
        `/api/workspaces/${workspaceId}/map/search?${qs}`,
      );
    },
    enabled: workspaceId != null && term.length >= 2,
    staleTime: 60_000,
  });
}

/** Reconstruye el grafo en el servidor (espera al motor) e invalida las vistas. */
export function useRefreshMap(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.post<{ meta: MapMeta; totals?: { nodes: number; edges: number } }>(
        `/api/workspaces/${workspaceId}/map/refresh`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-map', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['org-map-node', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['org-map-search', workspaceId] });
    },
  });
}

// ── Preguntas de arquitectura al investigador ───────────────────────────────

export interface MapFocusDto {
  seed: string;
  ids: string[];
  relations: Array<{
    consumer: string;
    provider: string;
    polarity: 'present' | 'absent';
    uses: number;
    endpoints: string[];
    complete: boolean;
  }>;
  query: string;
}

/** Veredicto del motor sobre una afirmación del modelo. */
export interface ClaimVerdictDto {
  claim:
    | { kind: 'relation'; consumer: string; provider: string; polarity: 'present' | 'absent' }
    | { kind: 'note'; text: string }
    | {
        kind: 'location';
        repo: string;
        path: string;
        line: number;
        contains: string;
        text: string;
      };
  verdict: 'verified' | 'contradicted' | 'unverifiable' | 'supported' | 'unsupported';
  reason: string;
  engine?: { uses: number; endpoints: string[]; complete: boolean };
}

export interface BlastConsumerDto {
  service: string;
  repo: string | null;
  uses: number;
  provenance: 'deterministic' | 'inferred';
  fields: string[];
  sites: Array<{ repo?: string; path: string; line?: number }>;
}
export interface BlastRadiusDto {
  key: string;
  service: string;
  repo: string | null;
  direct: BlastConsumerDto[];
  ripple: Array<{ service: string; repo: string | null; via: string; uses: number }>;
  totalUses: number;
  caveats: string[];
}
/** El resultado estructurado de una pregunta de recorrido o de impacto. */
export type RoadmapDto =
  | { kind: 'trace'; trace: TraceResultDto }
  | { kind: 'blast'; blast: BlastRadiusDto }
  | { kind: 'assessment'; orgId: string; assessmentId: string };

export interface AskResponse {
  answer: string;
  roadmap?: RoadmapDto;
  claims?: ClaimVerdictDto[];
  explanation_status: string;
  /** La conversación a la que se guardó este turno (null si no se guardó). */
  conversation?: { id: string; seq: number } | null;
  claims_summary: {
    total: number;
    verified: number;
    contradicted: number;
    unverifiable: number;
    supported: number;
    unsupported: number;
  };
  map_focus: MapFocusDto | null;
}

/** Un paso del investigador, tal como llega mientras trabaja (ver ProgressEvent en la API). */
export type ProgressEventDto =
  | { type: 'round'; round: number; toolCallsUsed: number; maxToolCalls: number; forced: boolean }
  | { type: 'tool'; tool: string; summary: string; ok: boolean; ms: number; note?: string }
  | { type: 'wrapup'; reason: 'budget' | 'locations' }
  | { type: 'verify'; claims: number };

export function useAsk(orgId: string | undefined) {
  // Lo que va pasando mientras responde. Se vacía al empezar cada pregunta.
  const [progress, setProgress] = useState<ProgressEventDto[]>([]);
  const mutation = useMutation({
    mutationFn: async (vars: { question: string; conversationId?: string | undefined }) => {
      setProgress([]);
      const body = {
        question: vars.question,
        orgId: orgId ?? '',
        ...(vars.conversationId ? { conversationId: vars.conversationId } : {}),
      };
      const streamed = await client.postSse<AskResponse>(
        '/api/query/stream',
        body,
        (event, data) => {
          if (event === 'progress') setProgress((p) => [...p, data as ProgressEventDto]);
        },
      );
      // Un servidor sin flujo responde igual por la ruta normal (sin progreso).
      return streamed ?? client.post<AskResponse>('/api/query', body);
    },
  });
  return Object.assign(mutation, { progress });
}

// ── Conversaciones (memoria del investigador, por token) ────────────────────

export interface ConversationSummaryDto {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
}

export interface TurnDto {
  seq: number;
  question: string;
  answer: string;
  status: string;
  claims: ClaimVerdictDto[];
  focus: MapFocusDto | null;
  /** Lo que se dibujó bajo la respuesta (roadmap, radio de impacto). */
  roadmap?: RoadmapDto;
  model: string | null;
  createdAt: number;
}

export function useConversations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['conversations', workspaceId],
    queryFn: () =>
      client.get<{ conversations: ConversationSummaryDto[] }>(
        `/api/conversations?workspaceId=${encodeURIComponent(workspaceId ?? '')}`,
      ),
    enabled: workspaceId != null,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () =>
      client.get<{ conversation: ConversationSummaryDto; turns: TurnDto[] }>(
        `/api/conversations/${id}`,
      ),
    enabled: id != null,
    retry: false,
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.del(`/api/conversations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export { client };

// ── Cabos sueltos: lo que el motor no ató, y qué es cada uno ────────────────

export type LooseCategory =
  | 'test_or_tooling'
  | 'external_call'
  | 'dynamic_target'
  | 'likely_real_link'
  | 'not_a_call'
  | 'unclear';

export interface LooseAssessmentDto {
  category: LooseCategory;
  reason: string;
  evidence: string | null;
  /** rule = exacto (ruta o motivo del motor); model = lectura de Nemotron, no un hecho del motor. */
  source: 'rule' | 'model';
  model?: string | null;
}

export interface LooseEndDto {
  key: string;
  group: string;
  kind: 'unresolved' | 'inferred';
  repo: string;
  path: string;
  line: number | null;
  reason: string;
  detail: {
    method?: string;
    template?: string;
    urlExpr?: string;
    targetService?: string;
    endpoint?: string;
    confidence?: number;
  };
  candidates: string[];
  candidateCount: number;
  assessment: LooseAssessmentDto | null;
}

export interface LooseEndsReportDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  generatedAt: number | null;
  items: LooseEndDto[];
  summary: { total: number; byCategory: Record<LooseCategory, number>; pendingCases: number };
  run: {
    state: 'idle' | 'running' | 'done' | 'failed';
    done: number;
    total: number;
    error?: string | null;
    usage?: { modelCalls: number; completionTokens: number; ms: number };
  };
}

export function useLooseEnds(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['loose-ends', workspaceId],
    queryFn: () => client.get<LooseEndsReportDto>(`/api/workspaces/${workspaceId}/loose-ends`),
    enabled: workspaceId != null && enabled,
    staleTime: 30_000,
    // Mientras el modelo trabaja se vuelve a preguntar; si no, no.
    refetchInterval: (q) => (q.state.data?.run.state === 'running' ? 2500 : false),
  });
}

export function useAssessLooseEnds(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.post<{ status: 'started' | 'running' }>(
        `/api/workspaces/${workspaceId}/loose-ends/assess`,
        {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['loose-ends', workspaceId] }),
  });
}

// ── ¿Qué código implementa este endpoint? (coincidencia por nombre) ─────────

export interface ImplementationDto {
  key: string;
  repo: string;
  tried: string[];
  candidates: Array<{ id: string; type: string; name: string; path: string; line: number }>;
  registeredIn: Array<{ name: string; path: string }>;
  basis: 'name_match';
  error?: string;
}

export function useImplementation(
  workspaceId: string | undefined,
  key: string,
  repo: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['map-implementation', workspaceId, repo, key],
    queryFn: () => {
      const qs = new URLSearchParams({ key, repo: repo ?? '' });
      return client.get<{
        source: 'lain' | 'unconfigured' | 'error';
        result?: ImplementationDto;
        error?: string;
      }>(`/api/workspaces/${workspaceId}/map/implementation?${qs}`);
    },
    enabled: enabled && workspaceId != null && repo != null,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

// ── Orientación: qué hay, cuáles son las puertas, quién usa qué ─────────────

export interface BriefingDto {
  totals: { repos: number; services: number; contracts: number; relations: number };
  repos: Array<{
    id: string;
    name: string;
    lainRepoId: string | null;
    services: Array<{
      id: string;
      name: string;
      contracts: number;
      groups: Array<{ key: string; label: string; count: number; note?: string }>;
    }>;
  }>;
  relations: Array<{
    from: string;
    to: string;
    uses: number;
    deterministic: number;
    inferred: number;
    contractsUsed: number;
  }>;
  hubs: Array<{ service: string; repo: string | null; consumerServices: number; uses: number }>;
  topOperations: Array<{
    key: string;
    service: string;
    group: string | null;
    uses: number;
    consumers: number;
  }>;
  gaps: Array<{ repo: string; reason: string }>;
}

export function useBriefing(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['map-briefing', workspaceId],
    queryFn: () =>
      client.get<{ briefing: BriefingDto | null; meta: MapMeta }>(
        `/api/workspaces/${workspaceId}/map/briefing`,
      ),
    enabled: workspaceId != null && enabled,
    staleTime: 60_000,
  });
}

// ── Trazado de punta a punta de un contrato ─────────────────────────────────

export type TraceLane =
  | 'data'
  | 'data_access'
  | 'domain'
  | 'api_handler'
  | 'contract'
  | 'client_call'
  | 'client_logic'
  | 'sink';

export interface TraceHopDto {
  id: string;
  lane: TraceLane;
  label: string;
  repo: string;
  path: string;
  line: number;
  contains: string;
  status: 'verified' | 'contradicted' | 'unverifiable';
  reason: string;
  origin: 'engine' | 'model';
}

export interface TraceLinkDto {
  from: string;
  to: string;
  relation: string;
  note?: string;
  basis: 'engine' | 'asserted' | 'not_found';
  because: string;
}

export interface TraceResultDto {
  seed: { key: string; service: string };
  summary: string;
  hops: TraceHopDto[];
  rejected: TraceHopDto[];
  links: TraceLinkDto[];
  gaps: Array<{ after: string; reason: string }>;
  sink: { hop: string; kind: string; note?: string } | null;
  complete: boolean;
  status: string;
  usage: {
    modelCalls: number;
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    ms: number;
  };
  errors: string[];
}

export function useTrace(workspaceId: string | undefined) {
  const [progress, setProgress] = useState<ProgressEventDto[]>([]);
  const mutation = useMutation({
    mutationFn: async (vars: { key: string; service?: string | null }) => {
      setProgress([]);
      const body = { key: vars.key, ...(vars.service ? { service: vars.service } : {}) };
      const base = `/api/workspaces/${workspaceId}/trace`;
      const streamed = await client.postSse<TraceResultDto>(
        `${base}/stream`,
        body,
        (event, data) => {
          if (event === 'progress') setProgress((p) => [...p, data as ProgressEventDto]);
        },
      );
      return streamed ?? client.post<TraceResultDto>(base, body);
    },
  });
  return Object.assign(mutation, { progress });
}

// ── Documentación que traen los repos ───────────────────────────────────────

export type DocKindDto = 'decision' | 'conventions' | 'domain' | 'guide' | 'readme' | 'security';
export interface DocEntryDto {
  repo: string;
  path: string;
  kind: DocKindDto;
  title: string;
  summary: string;
}

export function useDocs(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['docs', workspaceId],
    queryFn: () =>
      client.get<{
        source: 'lain' | 'unconfigured' | 'error';
        docs: DocEntryDto[];
        error?: string;
      }>(`/api/workspaces/${workspaceId}/docs`),
    enabled: workspaceId != null && enabled,
    staleTime: 10 * 60_000,
  });
}
