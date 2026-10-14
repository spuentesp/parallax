import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiClient, ApiEndpointNotImplemented } from './client.js';

// Token source: localStorage (set by user), URL hash (?token=...), or empty.
function getToken(): string | null {
  const fromStorage = localStorage.getItem('parallax_token');
  if (fromStorage) return fromStorage;
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}
const token = getToken();
if (token) localStorage.setItem('parallax_token', token);
const client = new ApiClient(token ? { token } : {});

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

// ── Evaluaciones (§13: el informe persistido) ───────────────────────────────

export interface AssessmentSummary {
  id: string;
  orgId: string;
  status: string;
  inputDigest: string;
  findingCount: number;
  coverageComplete: boolean;
  coverageSummary: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface AssessmentFinding {
  kind: string;
  side?: string;
  field?: string;
  route?: string;
  compat?: string;
  service?: string;
  endpoint?: { key?: string; service?: string };
  impact?: { class?: string; reasons?: string[] | string };
  affected?: Array<{ service?: string; class?: string; consumer?: string }>;
}

export interface AssessmentReport {
  id: string;
  orgId: string;
  inputDigest: string;
  status: string;
  baseId: string | null;
  headId: string | null;
  manifest: unknown;
  findings: AssessmentFinding[];
  engine: unknown;
  coverage: {
    complete?: boolean;
    summary?: string;
    scope?: {
      reviewed?: string[];
      unreviewed?: Array<{ repo: string; reason: string } | string>;
      excluded?: Array<{ repo: string; reason: string } | string>;
    };
  } | null;
  evidence: Array<{
    id: string;
    viewId: string;
    repo: string;
    sha: string;
    path: string;
    range: unknown;
    hash: string;
  }>;
  explanation: { status: string; revision: number | null; model: string | null };
  createdAt: number;
  completedAt: number | null;
}

export type AssessmentRequest =
  | { prUrl: string; orgId: string; configHash?: string; idempotencyKey?: string }
  | {
      repo: string;
      base: string;
      head: string;
      orgId: string;
      configHash?: string;
      excludeRepos?: string[];
      idempotencyKey?: string;
    };

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

export function useWorkspaceGraph(id: string | undefined) {
  return useQuery({
    queryKey: ['workspace-graph', id],
    queryFn: () => client.get<GraphRootResponse>(`/api/workspaces/${id}/graph`),
    enabled: id != null,
  });
}

// La expansión es imperativa (no un hook por fila): cada nodo abierto tiene
// su propia caché en el árbol y varias filas pueden estar expandidas a la vez.
export function fetchGraphChildren(
  workspaceId: string,
  ref: { repo: string; type: string; name: string },
): Promise<CodeGraphChildrenResponse> {
  const qs = new URLSearchParams({ repo: ref.repo, type: ref.type, name: ref.name });
  return client.get<CodeGraphChildrenResponse>(`/api/workspaces/${workspaceId}/graph/children?${qs}`);
}

export function fetchGraphSnippet(
  workspaceId: string,
  repo: string,
  symbol: string,
): Promise<GraphSnippetResponse> {
  const qs = new URLSearchParams({ repo, symbol });
  return client.get<GraphSnippetResponse>(`/api/workspaces/${workspaceId}/graph/snippet?${qs}`);
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
      return client
        .post<{ workspace: Workspace }>('/api/workspaces', ws)
        .then(async (res) => {
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

export function useAddRepo() {
  return useMutation({
    mutationFn: (vars: {
      workspaceId: string;
      repo: { uri: string; sha?: string; local?: string };
    }) => client.post(`/api/workspaces/${vars.workspaceId}/repos`, vars.repo),
  });
}

// ── Evidence (resolve_evidence + read_source contra la misma vista) ─────────

export interface EvidenceItemShape {
  exists: boolean;
  ref: string;
  reason?: string | undefined;
  snippet?: string | null | undefined;
  node?: {
    id: string;
    name?: string | undefined;
    node_type: string;
    ref: { commit: string; id: string; line: number; path: string; repo: string };
  } | undefined;
  source?: {
    text: string;
    path: string;
    start: number;
    end: number;
    commit: string;
    total_lines: number;
    error?: string | undefined;
  } | null | undefined;
}

export function useEvidence() {
  return useMutation({
    mutationFn: (vars: {
      workspaceId: string;
      refs: string[];
      contextLines?: number;
    }) =>
      client.post<{ items: EvidenceItemShape[]; source: string; error?: string }>(
        `/api/workspaces/${vars.workspaceId}/evidence`,
        {
          refs: vars.refs,
          ...(vars.contextLines !== undefined ? { contextLines: vars.contextLines } : {}),
        },
      ),
  });
}

export { client };
