// Límite de consultas por ventana deslizante. Protege los créditos de Token
// Factory en una demo pública: cada pregunta al investigador cuesta modelo, y un
// enlace compartido con muchos revisores no debe poder agotarlos.

export interface WindowLimiter {
  /** Intenta consumir una consulta de `key`. */
  take(key: string): { ok: true; remaining: number } | { ok: false; retryAfterMs: number };
}

export function createWindowLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): WindowLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    take(key) {
      const t = now();
      // Sólo cuentan las consultas dentro de la ventana; las viejas se descartan.
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: (recent[0] as number) + opts.windowMs - t };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true, remaining: opts.limit - recent.length };
    },
  };
}
