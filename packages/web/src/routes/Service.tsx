import type * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';

// Compatibilidad: /orgs/:orgId/services/:serviceId era un panel con datos de
// muestra. El servicio ahora se inspecciona en el mapa, así que el enlace
// viejo aterriza en el hub con ese servicio seleccionado y enfocado.
export function Service(): React.ReactElement {
  const { orgId, serviceId } = useParams();
  const id = `svc:${serviceId ?? ''}`;
  const q = new URLSearchParams({ focus: id, hops: '1', sel: id });
  return <Navigate to={`/orgs/${orgId ?? ''}?${q.toString()}`} replace />;
}
