// Memoria de navegación en el navegador. Puede no existir (modo privado, datos
// bloqueados): todo acceso va protegido y la app funciona sin ella.

function area(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStored(kind: 'local' | 'session', key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const a = area(kind);
    if (!a) return;
    if (value === null) a.removeItem(key);
    else a.setItem(key, value);
  } catch {
    // Sin almacenamiento: se pierde la memoria, no la función.
  }
}
