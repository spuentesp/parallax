import type * as React from 'react';

export function EvidencePanel(): React.ReactElement {
  return (
    <ul aria-label="Evidence" style={{ listStyle: 'none', padding: 0 }}>
      <li style={{ padding: 8, color: '#94a3b8' }}>Sin evidencia aún</li>
    </ul>
  );
}
