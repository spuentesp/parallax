import type * as React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { AssistantDock } from '../components/AssistantDock.js';

// Todo lo de un workspace (mapa, repos, contratos, evaluaciones) cuelga de aquí:
// el asistente se monta UNA vez, así el hilo no se pierde al cambiar de sección.
export function WorkspaceLayout(): React.ReactElement {
  const { orgId } = useParams();
  return (
    <>
      <Outlet />
      {orgId ? <AssistantDock key={orgId} workspaceId={orgId} /> : null}
    </>
  );
}
