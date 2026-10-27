import type { OrgNodeKind } from '@parallax/shared/org-map';
import type * as React from 'react';

// Un glifo por tipo de nodo, con el color del token (nunca un hex). Se usan en
// el árbol, el inspector y la leyenda para que "qué es esto" se lea igual en
// los tres sitios.

const COLOR: Record<OrgNodeKind, string> = {
  repo: 'var(--color-repo)',
  service: 'var(--color-service)',
  endpoint: 'var(--color-endpoint)',
};

export function KindIcon({
  kind,
  size = 14,
}: {
  kind: OrgNodeKind;
  size?: number;
}): React.ReactElement {
  const c = COLOR[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={kind}
      className="shrink-0"
    >
      <title>{kind}</title>
      {kind === 'repo' && (
        <>
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="3"
            fill="none"
            stroke={c}
            strokeWidth="1.6"
          />
          <rect x="5" y="5" width="6" height="6" rx="1.5" fill={c} opacity="0.35" />
        </>
      )}
      {kind === 'service' && (
        <rect x="2.5" y="3.5" width="11" height="9" rx="2.5" fill={c} opacity="0.85" />
      )}
      {kind === 'endpoint' && (
        <path
          d="M3 8h7M8 4l4 4-4 4"
          fill="none"
          stroke={c}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export const KIND_LABEL: Record<OrgNodeKind, string> = {
  repo: 'Repository',
  service: 'Service',
  endpoint: 'Endpoint',
};

/** Muestra de trazo: continuo = determinista, discontinuo = inferido. */
export function EdgeSwatch({
  provenance,
  width = 28,
}: {
  provenance: 'deterministic' | 'inferred';
  width?: number;
}): React.ReactElement {
  const color =
    provenance === 'deterministic' ? 'var(--color-deterministic)' : 'var(--color-inferred)';
  return (
    <svg
      width={width}
      height="8"
      viewBox={`0 0 ${width} 8`}
      aria-hidden="true"
      className="shrink-0"
    >
      <line
        x1="1"
        y1="4"
        x2={width - 6}
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={provenance === 'inferred' ? '5 3' : undefined}
        strokeLinecap="round"
      />
      <path d={`M${width - 7} 1l5 3-5 3z`} fill={color} />
    </svg>
  );
}
