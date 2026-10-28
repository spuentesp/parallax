// Un motor de código falso que responde como LAIN a lo que Parallax le pregunta
// (find de directorios/archivos, connect Contains): un árbol de carpetas con
// archivos, nombres repetidos en distintas ramas y los ids como única identidad.
// Se inyecta en el borde (queryGraph); nada del código bajo prueba se sustituye.

import type { QueryGraphResponse, QueryGraphSpec } from '@parallax/shared/lain';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

type Kind = 'Namespace' | 'File';
interface FakeNode {
  id: string;
  type: Kind;
  name: string;
  parent: string | null;
}

/** `tree`: ruta → archivos. "src/components" crea src y src/components. */
export function fakeCodeEngine(tree: Record<string, string[]>): LainAdapter {
  const nodes: FakeNode[] = [];
  const dirId = new Map<string, string>();
  const dir = (path: string): string => {
    const known = dirId.get(path);
    if (known) return known;
    const parts = path.split('/');
    const name = parts[parts.length - 1] ?? path;
    const parent = parts.length > 1 ? dir(parts.slice(0, -1).join('/')) : null;
    const id = `ns:${path}`;
    dirId.set(path, id);
    nodes.push({ id, type: 'Namespace', name, parent });
    return id;
  };
  for (const [path, files] of Object.entries(tree)) {
    const parent = path === '' ? null : dir(path);
    for (const f of files) nodes.push({ id: `f:${path}/${f}`, type: 'File', name: f, parent });
  }
  const out = (n: FakeNode) => ({ id: n.id, type: n.type, name: n.name });
  return {
    ...createLainMock(),
    async queryGraph(req): Promise<QueryGraphResponse> {
      const ops = (req.query as QueryGraphSpec).ops as Array<Record<string, unknown>>;
      const find = ops.find((o) => o.op === 'find') ?? {};
      const types = ([] as string[]).concat((find.type as string | string[]) ?? []);
      const exact = (find.name as { exact?: string } | undefined)?.exact;
      const connect = ops.find((o) => o.op === 'connect');
      let seeds = nodes.filter(
        (n) =>
          (types.length === 0 || types.includes(n.type)) &&
          (exact === undefined || n.name === exact),
      );
      if (connect) {
        const target = connect.target as { type?: string | string[] } | undefined;
        const want = target?.type ? ([] as string[]).concat(target.type) : null;
        const ids = new Set(seeds.map((s) => s.id));
        seeds = nodes.filter(
          (n) => n.parent !== null && ids.has(n.parent) && (!want || want.includes(n.type)),
        );
      }
      const limit =
        (ops.find((o) => o.op === 'limit')?.count as number | undefined) ?? seeds.length;
      const got = seeds.slice(0, limit).map(out);
      return { nodes: got, count: got.length } as QueryGraphResponse;
    },
  };
}
