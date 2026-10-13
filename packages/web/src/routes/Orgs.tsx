import type * as React from 'react';
import { Link } from 'react-router-dom';
import { useOrgs } from '../api/hooks.js';

export function Orgs(): React.ReactElement {
  const q = useOrgs();
  return (
    <section>
      <h1>Organizations</h1>
      {q.isPending ? <p>Cargando…</p> : null}
      {q.isError ? (
        <p style={{ color: '#dc2626' }}>
          No se pudo cargar la lista de organizaciones.
        </p>
      ) : (
        <ul>
          {(q.data?.orgs ?? []).map((o) => (
            <li key={(o as { id: string }).id}>
              <Link to={`/orgs/${(o as { id: string }).id}`}>
                {(o as { name: string }).name}
              </Link>
            </li>
          ))}
          {(q.data?.orgs ?? []).length === 0 ? <li>No hay organizaciones.</li> : null}
        </ul>
      )}
    </section>
  );
}
