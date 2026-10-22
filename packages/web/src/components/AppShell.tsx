import type * as React from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { OrgSwitcher } from './OrgSwitcher.js';
import { ThemeToggle } from './Theme.js';

export const NAV_ITEMS = [
  { to: '/orgs', label: 'Topología', icon: '⬡' },
  { to: '/assessments', label: 'Evaluaciones', icon: '◉' },
  { to: '/workspaces', label: 'Workspaces', icon: '◈' },
] as const;

export function AppShell(): React.ReactElement {
  const location = useLocation();
  const { orgId } = useParams();
  const targetFor = (base: string): string => {
    if (base === '/orgs' && orgId) return `/orgs/${orgId}`;
    if (base === '/assessments' && orgId) return `/orgs/${orgId}/assessments`;
    return base;
  };
  const isActive = (base: string): boolean => {
    if (base === '/orgs') {
      // El hub (y su panel) es Topología; las páginas de assessment no.
      return (
        orgId != null &&
        (location.pathname === `/orgs/${orgId}` ||
          location.pathname.startsWith(`/orgs/${orgId}/services`))
      );
    }
    return location.pathname.startsWith(targetFor(base));
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className="w-64 flex flex-col"
        style={{
          background: 'var(--color-surface, #171717)',
          borderRight: '1px solid var(--color-border, #262626)',
        }}
      >
        <div className="p-6">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--color-accent, #3b82f6)', color: '#fff', fontWeight: 700 }}
            >
              P
            </div>
            <div>
              <div className="font-semibold text-sm">Parallax</div>
              <div className="text-xs" style={{ color: 'var(--color-muted, #a3a3a3)' }}>
                Command Center
              </div>
            </div>
          </div>
        </div>

        <div className="px-3">
          <OrgSwitcher />
        </div>

        <nav className="flex-1 px-3">
          {NAV_ITEMS.filter((item) => item.to !== '/assessments' || orgId != null).map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={targetFor(item.to)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: active ? 'var(--color-accent, #3b82f6)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-fg, #fafafa)',
                  opacity: active ? 1 : 0.7,
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto" style={{ background: 'var(--color-bg, #0a0a0a)' }}>
        <Outlet />
      </main>
    </div>
  );
}
