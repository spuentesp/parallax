import { useQueryClient } from '@tanstack/react-query';
import type * as React from 'react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useWhoami } from '../api/hooks.js';
import { captureTokenFromUrl, clearToken, currentToken, saveToken } from '../api/token.js';

// Puerta de acceso: la SPA sólo se muestra con un token válido. Sin token (o con
// uno rechazado) pide uno; con un enlace `?token=` entra directo. No hay
// cuentas: un token es un acceso con alcance (lectura / escritura) por org.

export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  // Idempotente: tras guardar el token lo retira de la URL, así que repetirlo no hace nada.
  captureTokenFromUrl();
  const who = useWhoami();
  const qc = useQueryClient();

  if (who.isPending) {
    return (
      <div className="min-h-screen grid place-items-center bg-bg text-muted text-sm">
        Checking access…
      </div>
    );
  }
  if (who.isError) {
    const rejected = who.error instanceof ApiError && who.error.status === 401;
    if (!rejected) {
      return (
        <div className="min-h-screen grid place-items-center bg-bg p-6">
          <div className="max-w-sm text-center space-y-3">
            <p className="text-sm text-error">Could not reach the Parallax API.</p>
            <button
              type="button"
              onClick={() => void who.refetch()}
              className="px-3 py-1.5 rounded-lg text-sm bg-accent text-accent-fg"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return (
      <TokenScreen
        // Con un token guardado que el servidor rechaza se dice; sin token, no se regaña.
        rejected={currentToken() !== undefined}
        onSubmit={(t) => {
          saveToken(t);
          void qc.resetQueries();
        }}
      />
    );
  }
  return <>{children}</>;
}

export function TokenScreen({
  rejected = false,
  onSubmit,
}: {
  rejected?: boolean;
  onSubmit: (token: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-fg p-6">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 space-y-4 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg grid place-items-center bg-accent text-accent-fg font-bold">
            P
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Parallax</div>
            <div className="text-xs text-muted">Architecture command center</div>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="token" className="text-sm font-medium">
            Access token
          </label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {rejected && (
            <p role="alert" className="text-xs text-error">
              That token was not accepted.
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={value.trim() === ''}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium bg-accent text-accent-fg disabled:opacity-50"
        >
          Continue
        </button>
        <p className="text-xs text-muted">
          Reviewing a demo? Use the link you were given — it signs you in with a read-only token.
        </p>
      </form>
    </div>
  );
}

/** Cierra la sesión: olvida el token y vuelve a pedirlo. */
export function useSignOut(): () => void {
  const qc = useQueryClient();
  return () => {
    clearToken();
    void qc.resetQueries();
  };
}
