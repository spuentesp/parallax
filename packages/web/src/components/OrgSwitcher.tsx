import type * as React from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useOrgs } from '../api/hooks.js';

type OrgSummary = { id: string; name?: string };

export function OrgSwitcher(): React.ReactElement | null {
  const nested = useMatch('/orgs/:orgId/*');
  const exact = useMatch('/orgs/:orgId');
  const match = nested ?? exact;
  const orgId = match?.params.orgId;
  const { data } = useOrgs();
  const orgs = (data?.orgs ?? []) as OrgSummary[];
  const current = orgs.find((o) => o.id === orgId);
  if (!orgId) return null;

  return (
    <div className="px-3 py-2 mb-2 rounded-lg" style={{ background: 'var(--color-bg, #0a0a0a)' }}>
      <div className="text-xs text-muted">Organization</div>
      <div className="text-sm font-medium truncate">{current?.name ?? orgId}</div>
      <Link to="/orgs" className="text-xs text-accent" aria-label="Todas las organizaciones">
        Todas las organizaciones →
      </Link>
    </div>
  );
}
