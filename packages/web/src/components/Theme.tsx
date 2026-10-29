import type * as React from 'react';
import { useEffect, useState } from 'react';

// Design tokens for the org dev tool aesthetic (Linear/Vercel style).
export const THEME = {
  light: {
    bg: '#fafafa',
    surface: '#ffffff',
    fg: '#171717',
    muted: '#737373',
    border: '#e5e5e5',
    accent: '#4d7c0f',
    accentHover: '#3f6212',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
  },
  dark: {
    bg: '#0d0d0d',
    surface: '#161616',
    fg: '#fafafa',
    muted: '#a3a3a3',
    border: '#2a2a2a',
    accent: '#76b900',
    accentHover: '#8fd400',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
  },
} as const;

export function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
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
