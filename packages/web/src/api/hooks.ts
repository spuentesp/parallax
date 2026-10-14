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

export function useAssessment(id: string | null) {
  return useQuery({
    queryKey: ['assessment', id],
    queryFn: () => client.get(`/api/assessments/${id}`),
    enabled: id != null,
    retry: (count, err) => {
      if (err instanceof ApiEndpointNotImplemented) return false;
      return count < 2;
    },
  });
}

export function useCreateAssessment() {
  return useMutation({
    mutationFn: (body: unknown) => client.post('/api/assessments', body),
  });
}

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
  kind: 'service' | 'symbol' | 'contract';
  meta?: Record<string, unknown>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  kind: 'consumes' | 'calls' | 'has_field' | 'binds';
  meta?: Record<string, unknown>;
}

export interface TopologyResponse {
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] } | null;
  stats: {
    services: number;
    dependencies: number;
    repos: string[];
    unresolvedInbound: number;
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

export function useWorkspaceTopology(id: string | undefined) {
  return useQuery({
    queryKey: ['workspace-topology', id],
    queryFn: () => client.get<TopologyResponse>(`/api/workspaces/${id}/topology`),
    enabled: id != null,
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
