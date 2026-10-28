import type * as React from 'react';
import { Outlet, useMatch, useParams } from 'react-router-dom';
import { AssistantDock } from '../components/AssistantDock.js';

// Todo lo de un workspace (mapa, repos, contratos, evaluaciones) cuelga de aquí.
// El asistente se monta UNA vez (el hilo sobrevive al cambiar de sección): en el
// mapa va pegado a la derecha y abierto, porque grafo y chat son lo principal;
// en el resto de secciones flota.
export function WorkspaceLayout(): React.ReactElement {
  const { orgId } = useParams();
  const onMap = useMatch({ path: '/orgs/:orgId', end: true }) !== null;
  return (
    <div className="h-full flex min-w-0">
      <div className={`flex-1 min-w-0 h-full ${onMap ? 'overflow-hidden' : 'overflow-auto'}`}>
        <Outlet />
      </div>
      {orgId ? <AssistantDock key={orgId} workspaceId={orgId} docked={onMap} /> : null}
    </div>
  );
}
