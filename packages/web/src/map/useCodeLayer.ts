import { useCallback, useRef, useState } from 'react';
import { fetchGraphChildren, fetchGraphRoot } from '../api/hooks.js';
import { type CodeEntry, type CodeState, parseCodeId } from './code.js';

// Estado de la capa de código: qué nodos abrió el usuario y lo que LAIN
// devolvió para cada uno. Se pide al abrir un nodo (o al seleccionarlo, para
// listar sus relaciones) y se recuerda mientras dure la sesión del mapa.

export interface CodeLayer {
  open: ReadonlySet<string>;
  state: CodeState;
  /** Abre/cierra un nodo de código; pide a LAIN lo que aún no tiene. */
  toggle: (id: string, isOpen: boolean) => void;
  /** Pide lo del nodo si falta (sin abrirlo): las relaciones del inspector. */
  ensure: (id: string) => void;
  /** Olvida todo (tras un refresh del grafo). */
  reset: () => void;
}

export function useCodeLayer(workspaceId: string): CodeLayer {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<CodeState>({});
  // Lo ya pedido (o en vuelo) no se vuelve a pedir: ni un doble clic ni un
  // re-render duplican las siete consultas de un nodo.
  const requested = useRef(new Set<string>());

  const put = useCallback((id: string, entry: CodeEntry) => {
    setState((prev) => ({ ...prev, [id]: entry }));
  }, []);

  const load = useCallback(
    (id: string) => {
      const parsed = parseCodeId(id);
      if (!parsed || requested.current.has(id)) return;
      requested.current.add(id);
      put(id, { state: 'loading' });
      const fail = (e: unknown) => {
        // Un fallo se puede reintentar: no queda registrado como pedido.
        requested.current.delete(id);
        put(id, {
          state: 'error',
          message: e instanceof Error ? e.message : 'LAIN request failed',
        });
      };
      if (parsed.kind === 'root') {
        fetchGraphRoot(workspaceId, parsed.repo)
          .then((res) => {
            const root = res.graph?.repos[0];
            if (res.source !== 'lain' || !root || root.error) {
              fail(new Error(root?.error ?? res.error ?? 'code graph unavailable'));
              return;
            }
            put(id, {
              state: 'ready',
              children: root.nodes,
              truncated: root.truncated,
              hidden: root.hidden ?? 0,
              communications: [],
            });
          })
          .catch(fail);
        return;
      }
      fetchGraphChildren(workspaceId, parsed)
        .then((res) => {
          if (res.source !== 'lain') {
            fail(new Error(res.error ?? 'code graph unavailable'));
            return;
          }
          put(id, {
            state: 'ready',
            children: res.children ?? [],
            truncated: res.childrenTruncated ?? false,
            hidden: res.childrenHidden ?? 0,
            communications: res.communications ?? [],
          });
        })
        .catch(fail);
    },
    [workspaceId, put],
  );

  const toggle = useCallback(
    (id: string, isOpen: boolean) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!isOpen) load(id);
    },
    [load],
  );

  const reset = useCallback(() => {
    requested.current = new Set();
    setState({});
    setOpen(new Set());
  }, []);

  return { open, state, toggle, ensure: load, reset };
}
