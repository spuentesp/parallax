import type * as React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../api/hooks.js';
import { AssistantDock } from '../components/AssistantDock.js';
import { FlowActions } from '../components/FlowActions.js';
import { MapExplorer } from '../map/MapExplorer.js';
import { nodeContext } from '../map/nodeId.js';

// Hub del command center: el mapa de la organización con el investigador al
// lado. El org se identifica con su workspace (es el mismo id que usa
// /api/query). Lo seleccionado vive en la URL (?sel=), así que las acciones de
// flujo (evaluar un PR) heredan el contexto y un enlace reproduce la vista.

export function OrgLayout(): React.ReactElement {
  const { orgId } = useParams();
  const [params] = useSearchParams();
  const ws = useWorkspace(orgId);
  const ctx = nodeContext(params.get('sel'));

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xs font-medium text-muted mb-1">Organization</div>
        <h1 className="text-2xl font-bold">{ws.data?.workspace?.name ?? orgId}</h1>
      </div>

      <FlowActions orgId={orgId ?? ''} selectedNode={ctx} />

      {orgId ? <MapExplorer workspaceId={orgId} /> : null}
      {orgId ? <AssistantDock workspaceId={orgId} /> : null}
    </div>
  );
}
