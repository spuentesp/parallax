import type { ReactNode } from 'react';
import { Outlet, Link } from 'react-router-dom';

export function AppShell(): ReactNode {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <aside style={{ background: '#0f172a', color: '#fff', padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Parallax</h2>
        <nav style={{ marginTop: 16 }}>
          <Link to="/orgs" style={{ color: '#cbd5e1' }}>
            Organizations
          </Link>
        </nav>
      </aside>
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
