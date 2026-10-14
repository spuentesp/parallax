import type * as React from 'react';

// Design tokens for the org dev tool aesthetic (Linear/Vercel style).
export const THEME = {
  light: {
    bg: '#fafafa',
    surface: '#ffffff',
    fg: '#171717',
    muted: '#737373',
    border: '#e5e5e5',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
  },
  dark: {
    bg: '#0a0a0a',
    surface: '#171717',
    fg: '#fafafa',
    muted: '#a3a3a3',
    border: '#262626',
    accent: '#3b82f6',
    accentHover: '#60a5fa',
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

import { useEffect, useState } from 'react';

export function ThemeToggle(): React.ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        background: 'transparent',
        border: `1px solid ${dark ? '#262626' : '#e5e5e5'}`,
        borderRadius: 6,
        padding: '6px 10px',
        color: dark ? '#a3a3a3' : '#737373',
        cursor: 'pointer',
        fontSize: 13,
      }}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
