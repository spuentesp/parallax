import type * as React from 'react';

export function ServiceMap(): React.ReactElement {
  return (
    <div
      role="region"
      aria-label="Service map"
      style={{
        minHeight: 320,
        background: '#1e293b',
        color: '#cbd5e1',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 8,
      }}
    >
      Mapa de servicios (subproject 4)
    </div>
  );
}
