import type * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle } from './Theme.js';

const NAV_ITEMS = [
  { to: '/workspaces', label: 'Workspaces', icon: '⬡' },
  { to: '/orgs', label: 'Organizations', icon: '⬡' },
  { to: '/assessments', label: 'Assessments', icon: '◉' },
  { to: '/proposals', label: 'Proposals', icon: '◈' },
];

export function AppShell(): React.ReactElement {
  const location = useLocation();
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

        <nav className="flex-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
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
