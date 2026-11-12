// El workspace en el que se está trabajando. UNA sola fuente para la barra
// lateral, el selector y el asistente: la URL (/orgs/:orgId/…) manda; fuera de
// ella, el último que se usó; si no, el primero que exista. Así la navegación
// nunca cambia de forma según la pantalla.

import { useEffect } from 'react';
import { useMatch } from 'react-router-dom';
import { useWorkspaces } from '../api/hooks.js';
import { readStored, writeStored } from './storage.js';

const LAST_ORG = 'parallax.org';

export interface CurrentOrg {
  orgId: string | null;
  /** Aún no se sabe cuál es (la lista de workspaces está cargando). */
  loading: boolean;
}

export function useCurrentOrg(): CurrentOrg {
  const fromUrl = useMatch({ path: '/orgs/:orgId', end: false })?.params.orgId ?? null;
  const list = useWorkspaces();

  useEffect(() => {
    if (fromUrl) writeStored('local', LAST_ORG, fromUrl);
  }, [fromUrl]);

  if (fromUrl) return { orgId: fromUrl, loading: false };
  const ids = (list.data?.workspaces ?? []).map((w) => w.id);
  const remembered = readStored('local', LAST_ORG);
  if (remembered && (list.isPending || ids.includes(remembered))) {
    return { orgId: remembered, loading: false };
  }
  if (list.isPending) return { orgId: null, loading: true };
  return { orgId: ids[0] ?? null, loading: false };
}
