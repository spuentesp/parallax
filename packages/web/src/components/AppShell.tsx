import type * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useWhoami } from '../api/hooks.js';
import { useCurrentOrg } from '../nav/currentOrg.js';
import { readMapSearch } from '../nav/mapState.js';
import { useSignOut } from './AuthGate.js';
import { LogoMark } from './Logo.js';
import { OrgSwitcher } from './OrgSwitcher.js';
import { ThemeToggle } from './Theme.js';

// La barra lateral es SIEMPRE la misma: las secciones del workspace actual. Sin
// workspace (aún no hay ninguno) se muestran igual, deshabilitadas.
export const NAV_ITEMS = [
  { key: 'map', label: 'Map', icon: 'map', path: '' },
  { key: 'repos', label: 'Repositories', icon: 'repos', path: '/repos' },
  { key: 'contracts', label: 'Contracts', icon: 'contracts', path: '/contracts' },
  { key: 'assessments', label: 'Assessments', icon: 'assess', path: '/assessments' },
] as const;

function NavIcon({ name }: { name: (typeof NAV_ITEMS)[number]['icon'] }): React.ReactElement {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'map') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="4" cy="4" r="1.8" />
        <circle cx="12" cy="5" r="1.8" />
        <circle cx="8" cy="12" r="1.8" />
        <path d="M5.6 4.4l4.8.4M4.8 5.7l2.2 4.6M11.2 6.6L9 10.4" />
      </svg>
    );
  }
  if (name === 'repos') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (name === 'contracts') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M6.5 9.5l3-3M5 7.5l-1.2 1.2a2.1 2.1 0 0 0 3 3L8 10.5M11 8.5l1.2-1.2a2.1 2.1 0 0 0-3-3L8 5.5" />
      </svg>
    );
  }
  if (name === 'assess') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3 2.5h7l3 3v8H3z" />
        <path d="M5.5 8.5l1.7 1.7 3.3-3.4" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

export function AppShell(): React.ReactElement {
  const location = useLocation();
  const { orgId } = useCurrentOrg();
  const who = useWhoami();
  const signOut = useSignOut();
  const base = orgId ? `/orgs/${orgId}` : null;
  // Volver al mapa lo deja como se dejó (filtros, foco, nodos abiertos).
  const targetFor = (item: (typeof NAV_ITEMS)[number]): string | null => {
    if (!base) return null;
    if (item.key !== 'map') return `${base}${item.path}`;
    const saved = readMapSearch(orgId ?? '');
    return saved === '' ? base : `${base}?${saved}`;
  };
  const isActive = (item: (typeof NAV_ITEMS)[number]): boolean => {
    if (!base) return false;
    const path = location.pathname;
    if (item.key === 'map') return path === base || path.startsWith(`${base}/services`);
    return path === `${base}${item.path}` || path.startsWith(`${base}${item.path}/`);
  };

  return (
    <div className="flex h-screen bg-bg text-fg">
      <aside
        className="w-[4.75rem] shrink-0 flex flex-col items-stretch bg-surface border-r border-border"
        aria-label="Navigation"
      >
        <div className="mx-auto mt-3" title="Parallax — architecture command center">
          <LogoMark size={36} />
        </div>

        <div className="px-1.5 mt-3">
          <OrgSwitcher />
        </div>

        <nav className="flex-1 px-1.5 mt-2 space-y-1" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const to = targetFor(item);
            const active = isActive(item);
            const cls = `flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] leading-none transition-colors ${
              active
                ? 'bg-accent/10 text-accent font-medium'
                : to
                  ? 'text-muted hover:bg-bg hover:text-fg'
                  : 'text-muted/50 cursor-not-allowed'
            }`;
            return to ? (
              <Link
                key={item.key}
                to={to}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                className={cls}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <span key={item.key} aria-disabled="true" className={cls}>
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </span>
            );
          })}
        </nav>

        <div className="py-3 flex flex-col items-center gap-1.5">
          {who.data?.readOnly && (
            <span
              className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[9px] text-muted"
              data-testid="read-only-badge"
              title="Read-only access: you can explore and ask questions, not change anything."
            >
              read-only
            </span>
          )}
          <ThemeToggle compact />
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-bg hover:text-fg transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6.5" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto bg-bg">
        <Outlet />
      </main>
    </div>
  );
}
