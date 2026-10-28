// Token de acceso de la sesión. Vive en localStorage (con try/catch: puede estar
// bloqueado) y puede llegar en un enlace (`?token=…`), que se guarda y se quita
// de la barra de direcciones para que no quede en el historial ni al compartir
// la URL.

const KEY = 'parallax_token';

export function readToken(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(KEY, token.trim());
  } catch {
    // Sin almacenamiento la sesión dura lo que dure la pestaña (token en memoria).
    memory = token.trim();
  }
}

export function clearToken(): void {
  memory = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada que borrar
  }
}

let memory: string | undefined;
export const currentToken = (): string | undefined => readToken() ?? memory;

/** Guarda el token del enlace (si lo hay) y lo retira de la URL. */
export function captureTokenFromUrl(): boolean {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('token');
  if (!t) return false;
  saveToken(t);
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
