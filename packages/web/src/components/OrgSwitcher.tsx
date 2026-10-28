import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs, useWorkspace } from '../api/hooks.js';
import { useCurrentOrg } from '../nav/currentOrg.js';

type OrgSummary = { id: string; name?: string };

// El workspace actual, siempre visible, con la salida a la lista. Mismo lugar y
// misma forma en todas las pantallas.
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
    <div className="px-3 py-2.5 mb-2 rounded-lg bg-bg border border-border">
      <div className="text-[11px] uppercase tracking-wide text-muted">Workspace</div>
      <div className="text-sm font-medium truncate">{name}</div>
      <Link to="/orgs" className="text-xs text-accent hover:underline">
        {orgId ? 'All workspaces →' : 'Create one →'}
      </Link>
    </div>
  );
}
