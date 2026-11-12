import type * as React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useCurrentOrg } from '../nav/currentOrg.js';

// Las URL antiguas siguen vivas como redirects que CONSERVAN la query: un enlace
// con ?token=… no pierde el acceso al pasar por aquí.

/** `/` → el mapa del workspace actual (el último usado, o el primero), o la lista. */
export function Home(): React.ReactElement {
  const { orgId, loading } = useCurrentOrg();
  const { search } = useLocation();
  if (loading) return <p className="p-6 text-sm text-muted">Loading…</p>;
  return <Navigate to={{ pathname: orgId ? `/orgs/${orgId}` : '/orgs', search }} replace />;
}

/** `/workspaces` → `/orgs` (la lista de workspaces es una sola). */
export function ToWorkspaceList(): React.ReactElement {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/orgs', search }} replace />;
}

const TAB_PATH: Record<string, string> = { repos: '/repos', contracts: '/contracts' };

/** `/workspaces/:id?tab=repos` → `/orgs/:id/repos`; cualquier otra pestaña (o `graph`) → el mapa. */
export function WorkspaceRedirect(): React.ReactElement {
  const { id } = useParams();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get('tab') ?? '';
  params.delete('tab');
  const rest = params.toString();
  return (
    <Navigate
      to={{ pathname: `/orgs/${id ?? ''}${TAB_PATH[tab] ?? ''}`, search: rest ? `?${rest}` : '' }}
      replace
    />
  );
}
