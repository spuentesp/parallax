// Token de acceso de la sesión. Vive en localStorage (con try/catch: puede estar
// bloqueado). Si llega en un enlace (`?token=…`) lo guarda y lo quita de la URL
// la puerta de acceso (AuthGate), por el router.

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
