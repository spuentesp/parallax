import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs, useWorkspace } from '../api/hooks.js';
import { useCurrentOrg } from '../nav/currentOrg.js';

type OrgSummary = { id: string; name?: string };

// El workspace actual, siempre visible y en el mismo lugar: una pastilla con su
// inicial y nombre, que lleva a la lista. Compacta: el espacio es del mapa.
export function OrgSwitcher(): React.ReactElement {
  const { orgId, loading } = useCurrentOrg();
  const { data } = useOrgs();
  // El org es su workspace: si /api/orgs no lo conoce, el nombre sale de ahí.
  const ws = useWorkspace(orgId ?? undefined);
  const orgs = (data?.orgs ?? []) as OrgSummary[];
  const current = orgs.find((o) => o.id === orgId);
  const name = orgId
    ? (current?.name ?? ws.data?.workspace?.name ?? orgId)
    : loading
      ? 'Loading…'
      : 'No workspace yet';

  return (
    <Link
      to="/orgs"
      title={orgId ? `${name} — all workspaces` : 'Create a workspace'}
      aria-label={orgId ? `All workspaces (current: ${name})` : 'Create a workspace'}
      className="block rounded-lg border border-border bg-bg px-1 py-1.5 text-center hover:border-accent transition-colors"
    >
      <span className="block text-[9px] uppercase tracking-wide text-muted">Workspace</span>
      <span className="block truncate text-[11px] font-medium">{name}</span>
    </Link>
  );
}
