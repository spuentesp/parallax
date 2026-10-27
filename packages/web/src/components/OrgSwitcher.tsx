import type * as React from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useOrgs, useWorkspace } from '../api/hooks.js';

type OrgSummary = { id: string; name?: string };

export function OrgSwitcher(): React.ReactElement | null {
  const nested = useMatch('/orgs/:orgId/*');
  const exact = useMatch('/orgs/:orgId');
  const match = nested ?? exact;
  const orgId = match?.params.orgId;
  const { data } = useOrgs();
  // El org es su workspace: si /api/orgs no lo conoce, el nombre sale de ahí.
  const ws = useWorkspace(orgId);
  const orgs = (data?.orgs ?? []) as OrgSummary[];
  const current = orgs.find((o) => o.id === orgId);
  if (!orgId) return null;

  return (
    <div className="px-3 py-2.5 mb-2 rounded-lg bg-bg border border-border">
      <div className="text-[11px] uppercase tracking-wide text-muted">Organization</div>
      <div className="text-sm font-medium truncate">
        {current?.name ?? ws.data?.workspace?.name ?? orgId}
      </div>
      <Link to="/orgs" className="text-xs text-accent hover:underline">
        All organizations →
      </Link>
    </div>
  );
}
