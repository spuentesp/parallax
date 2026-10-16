import type * as React from 'react';

export function ContextPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <aside
      className="mt-6 rounded-xl p-4"
      style={{
        background: 'var(--color-surface, #171717)',
        border: '1px solid var(--color-border, #262626)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">{title}</div>
        <button type="button" onClick={onClose} className="text-xs text-accent">
          Cerrar ✕
        </button>
      </div>
      {children}
    </aside>
  );
}
