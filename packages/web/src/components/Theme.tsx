import type * as React from 'react';
import { useEffect, useState } from 'react';

// El tema vive en la clase `dark` de <html>; los colores salen de los tokens de
// index.css. Este módulo sólo decide si esa clase está puesta — la paleta no
// se duplica aquí: una segunda copia de los mismos hex se desincroniza sola.
const KEY = 'parallax.theme';

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark') return true;
    if (v === 'light') return false;
  } catch {
    // sin almacenamiento: el tema dura lo que dure la pestaña
  }
  return null;
}

function store(dark: boolean): void {
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    // nada que hacer: el tema sigue funcionando en memoria
  }
}

export function useTheme() {
  // Oscuro por defecto; si el usuario eligió, manda su elección.
  const [dark, setDark] = useState(() => readStored() ?? true);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    store(dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function ThemeToggle({ compact = false }: { compact?: boolean }): React.ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`flex items-center justify-center gap-2 rounded-lg text-xs text-muted hover:bg-bg hover:text-fg transition-colors ${
        compact ? 'h-8 w-8' : 'border border-border px-3 py-1.5'
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {dark ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
          </>
        ) : (
          <path d="M13 9.5A5.5 5.5 0 116.5 3a4.5 4.5 0 006.5 6.5z" />
        )}
      </svg>
      {compact ? null : dark ? 'Light' : 'Dark'}
    </button>
  );
}
