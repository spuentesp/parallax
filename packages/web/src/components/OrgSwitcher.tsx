import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs, useWorkspace } from '../api/hooks.js';
import { useCurrentOrg } from '../nav/currentOrg.js';

type OrgSummary = { id: string; name?: string };

// El workspace actual, siempre visible y en el mismo lugar: un avatar compacto
// lleva a la lista y deja el nombre completo en el tooltip y la accesibilidad.
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
  const initials = name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <Link
      to="/orgs"
      title={orgId ? `${name} — all workspaces` : 'Create a workspace'}
      aria-label={orgId ? `All workspaces (current: ${name})` : 'Create a workspace'}
      className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-xs font-semibold text-accent transition-colors hover:border-accent hover:bg-accent-soft"
    >
      <span aria-hidden="true">{initials}</span>
      <span className="sr-only">Workspace</span>
      <span className="sr-only">{name}</span>
    </Link>
  );
}
