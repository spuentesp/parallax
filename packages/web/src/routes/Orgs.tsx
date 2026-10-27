import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs, useWorkspaces } from '../api/hooks.js';

type OrgSummary = { id: string; name: string };

// Un org es un workspace de LAIN: su mapa vive en /orgs/<id>. /api/orgs aún no
// lista organizaciones propias, así que el selector ofrece también los
// workspaces configurados — es lo único que hoy tiene un mapa que abrir.
export function Orgs(): React.ReactElement {
  const orgs = useOrgs();
  const workspaces = useWorkspaces();
  const listed = (orgs.data?.orgs ?? []) as OrgSummary[];
  const fromWorkspaces: OrgSummary[] = (workspaces.data?.workspaces ?? []).map((w) => ({
    id: w.id,
    name: w.name,
  }));
  const all = [...listed, ...fromWorkspaces.filter((w) => !listed.some((o) => o.id === w.id))];
  const loading = orgs.isPending || workspaces.isPending;

  return (
    <section className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Organizations</h1>
      <p className="text-sm text-muted mb-5">
        Pick one to open its architecture map: repositories, services, endpoints and who consumes
        what.
      </p>
      {loading ? <p className="text-sm text-muted">Loading…</p> : null}
      {orgs.isError && workspaces.isError ? (
        <p className="text-sm text-error">Could not load the list of organizations.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {all.map((o) => (
            <li key={o.id}>
              <Link
                to={`/orgs/${o.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 hover:border-accent transition-colors"
              >
                <span className="font-medium">{o.name}</span>
                <span className="block text-xs text-muted font-mono truncate">{o.id}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!loading && all.length === 0 && !(orgs.isError && workspaces.isError) ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
          No organizations yet.{' '}
          <Link to="/workspaces" className="text-accent hover:underline">
            Configure a workspace →
          </Link>
        </div>
      ) : null}
    </section>
  );
}
