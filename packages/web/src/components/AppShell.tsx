import type * as React from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useWhoami } from '../api/hooks.js';
import { useSignOut } from './AuthGate.js';
import { OrgSwitcher } from './OrgSwitcher.js';
import { ThemeToggle } from './Theme.js';

export const NAV_ITEMS = [
  { to: '/orgs', label: 'Map', icon: 'map' },
  { to: '/assessments', label: 'Assessments', icon: 'assess' },
  { to: '/workspaces', label: 'Workspaces', icon: 'workspace' },
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
  // En /workspaces/:id el workspace es el org: la barra lateral no cambia de forma.
  const { orgId: orgParam, id: workspaceParam } = useParams();
  const orgId = orgParam ?? workspaceParam;
  const who = useWhoami();
  const signOut = useSignOut();
  const targetFor = (base: string): string => {
    if (base === '/orgs' && orgId) return `/orgs/${orgId}`;
    if (base === '/assessments' && orgId) return `/orgs/${orgId}/assessments`;
    return base;
  };
  const isActive = (base: string): boolean => {
    if (base === '/orgs') {
      // El hub (y su panel) es el mapa; las páginas de assessment no.
      return (
        orgId != null &&
        (location.pathname === `/orgs/${orgId}` ||
          location.pathname.startsWith(`/orgs/${orgId}/services`))
      );
    }
    return location.pathname.startsWith(targetFor(base));
  };

  return (
    <div className="flex h-screen bg-bg text-fg">
      <aside className="w-60 shrink-0 flex flex-col bg-surface border-r border-border">
        <div className="p-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg grid place-items-center bg-accent text-accent-fg font-bold">
              P
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-sm">Parallax</div>
              <div className="text-xs text-muted">Architecture command center</div>
            </div>
          </div>
        </div>

        <div className="px-3">
          <OrgSwitcher />
        </div>

        <nav className="flex-1 px-3 space-y-0.5" aria-label="Main">
          {NAV_ITEMS.filter((item) => item.to !== '/assessments' || orgId != null).map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={targetFor(item.to)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-muted hover:bg-bg hover:text-fg'
                }`}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 space-y-2">
          {who.data?.readOnly && (
            <p
              className="rounded-lg border border-border bg-bg px-3 py-1.5 text-[11px] text-muted"
              data-testid="read-only-badge"
            >
              Read-only access: you can explore and ask questions, not change anything.
            </p>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-bg hover:text-fg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-bg">
        <Outlet />
      </main>
    </div>
  );
}
