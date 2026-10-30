import type * as React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FlowActions } from '../components/FlowActions.js';
import { MapExplorer } from '../map/MapExplorer.js';
import { nodeContext } from '../map/nodeId.js';

// El mapa del workspace ocupa toda la pantalla: sin cabecera propia (el nombre
// está en la barra lateral). Lo seleccionado vive en la URL (?sel=), así que la
// acción de evaluar un PR hereda el contexto y un enlace reproduce la vista.

export function OrgLayout(): React.ReactElement {
  const { orgId } = useParams();
  const [params] = useSearchParams();
  const ctx = nodeContext(params.get('sel'));

  return (
    <div className="h-full">
      {orgId ? (
        <MapExplorer
          // Otro workspace es otro mapa: se monta de cero. Sin esto, el mapa
          // nuevo hereda los nodos abiertos, los recuentos y las posiciones del
          // anterior, y parece que al cambiar de workspace no pasa nada.
          key={orgId}
          workspaceId={orgId}
          actions={<FlowActions orgId={orgId} selectedNode={ctx} />}
        />
      ) : null}
    </div>
  );
}
