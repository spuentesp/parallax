import { useCallback, useState } from 'react';
import { readStored, writeStored } from '../nav/storage.js';
import { CHAPTERS, DEFAULT_TASK, type Role, type TourContext } from './chapters.js';

// El progreso del recorrido, por workspace, en este navegador. (La conversación
// y sus afirmaciones verificadas viven en el servidor; esto sólo recuerda en qué
// capítulo vas y para qué tarea.)

export interface TourState extends TourContext {
  /** Capítulo en el que estás (n), o null si aún no empezaste. */
  current: number | null;
  done: number[];
}

const key = (ws: string) => `parallax.tour.${ws}`;

function read(ws: string): TourState | null {
  const raw = readStored('local', key(ws));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TourState>;
    const roles: Role[] = ['frontend', 'backend', 'fullstack'];
    if (!v.role || !roles.includes(v.role) || typeof v.task !== 'string') return null;
    return {
      role: v.role,
      task: v.task,
      current: typeof v.current === 'number' ? v.current : null,
      done: Array.isArray(v.done) ? v.done.filter((n): n is number => typeof n === 'number') : [],
    };
  } catch {
    return null;
  }
}

export function useOnboarding(workspaceId: string) {
  const [state, setState] = useState<TourState | null>(() => read(workspaceId));
  const save = useCallback(
    (next: TourState | null) => {
      setState(next);
      writeStored('local', key(workspaceId), next ? JSON.stringify(next) : null);
    },
    [workspaceId],
  );

  return {
    state,
    /** Empieza (o reinicia) el recorrido en el capítulo 1. */
    start: (role: Role, task: string) =>
      save({ role, task: task.trim() || DEFAULT_TASK, current: 1, done: [] }),
    /** Pasa a un capítulo; el anterior queda hecho. */
    goTo: (n: number) => {
      if (!state) return;
      const done =
        state.current !== null ? [...new Set([...state.done, state.current])] : state.done;
      save({ ...state, current: n, done });
    },
    finish: () => {
      if (!state) return;
      const done =
        state.current !== null ? [...new Set([...state.done, state.current])] : state.done;
      save({ ...state, current: null, done });
    },
    leave: () => save(null),
    next: (): number | null => {
      if (!state || state.current === null) return null;
      const i = CHAPTERS.findIndex((c) => c.n === state.current);
      return CHAPTERS[i + 1]?.n ?? null;
    },
  };
}
