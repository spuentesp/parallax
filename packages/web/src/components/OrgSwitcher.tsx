import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs, useWorkspace } from '../api/hooks.js';
import { useCurrentOrg } from '../nav/currentOrg.js';

type OrgSummary = { id: string; name?: string };

// El workspace actual, siempre visible y en el mismo lugar: un avatar compacto
// lleva a la lista y deja el nombre completo en el tooltip y la accesibilidad.
export function OrgSwitcher({ compact = false }: { compact?: boolean } = {}): React.ReactElement {
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

  if (compact) {
    return (
      <Link
        to="/orgs"
        title={orgId ? `${name} — all workspaces` : 'Create a workspace'}
        aria-label={orgId ? `All workspaces (current: ${name})` : 'Create a workspace'}
        className="mx-auto grid h-9 w-9 place-items-center rounded-xl border border-border bg-bg text-xs font-semibold text-accent transition-colors hover:border-accent hover:bg-accent-soft"
      >
        <span aria-hidden="true">{initials}</span>
        <span className="sr-only">Workspace</span>
        <span className="sr-only">{name}</span>
      </Link>
    );
  }

  // Recuadro de la referencia: etiqueta, nombre y, en mono, el id.
  return (
    <Link
      to="/orgs"
      title={orgId ? `${name} — all workspaces` : 'Create a workspace'}
      aria-label={orgId ? `All workspaces (current: ${name})` : 'Create a workspace'}
      className="block rounded-lg border border-border bg-surface-2 px-2.5 py-2 transition-colors hover:border-accent"
    >
      <div className="text-[11px] text-muted">Workspace</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] font-medium">
        <span className="min-w-0 break-words">{name}</span>
        {orgId && name !== orgId && (
          <span className="max-w-full truncate font-mono text-xs font-normal text-muted">
            {orgId}
          </span>
        )}
      </div>
    </Link>
  );
}
