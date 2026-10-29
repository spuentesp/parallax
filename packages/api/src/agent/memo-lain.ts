import type { LainAdapter } from '../lain-adapter/types.js';

/**
 * Una investigación lee a LAIN lo mismo varias veces: `get_service` de un servicio
 * (660 KB, ~4 s en Saleor) lo piden la herramienta, `consumers_of` y la verificación
 * de cada afirmación de relación. La vista está fijada durante la investigación, así
 * que repetir la misma lectura no puede dar otra respuesta: se memoriza por llamada
 * (sólo dentro de UNA investigación; nada se comparte entre preguntas).
 */
export function memoizeReads(lain: LainAdapter): LainAdapter {
  const cache = new Map<string, Promise<unknown>>();
  const once = <A, R>(name: string, fn: (a: A) => Promise<R>) => {
    return (a: A): Promise<R> => {
      const key = `${name}:${JSON.stringify(a)}`;
      const hit = cache.get(key);
      if (hit) return hit as Promise<R>;
      const p = fn(a);
      cache.set(key, p);
      // Un fallo no se memoriza: el siguiente intento vuelve a preguntar.
      p.catch(() => cache.delete(key));
      return p;
    };
  };
  const overrides: Record<string, unknown> = {
    getService: once('getService', (a: Parameters<LainAdapter['getService']>[0]) =>
      lain.getService(a),
    ),
    listServices: once('listServices', (a: Parameters<LainAdapter['listServices']>[0]) =>
      lain.listServices(a),
    ),
    listContracts: once('listContracts', (a: Parameters<LainAdapter['listContracts']>[0]) =>
      lain.listContracts(a),
    ),
  };
  // Un Proxy y no `{...lain}`: el cliente real es una CLASE y sus métodos viven en el
  // prototipo; copiar sus propiedades los perdería (getCodeSnippet, queryGraph…).
  return new Proxy(lain, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
