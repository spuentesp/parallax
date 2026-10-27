import type { OrgNodeKind } from '@parallax/shared/org-map';
import type * as React from 'react';

// Un glifo por tipo de nodo, con el color del token (nunca un hex). Se usan en
// el árbol, el inspector y la leyenda para que "qué es esto" se lea igual en
// los tres sitios.

const COLOR: Record<OrgNodeKind, string> = {
  repo: 'var(--color-repo)',
  service: 'var(--color-service)',
  endpoint: 'var(--color-endpoint)',
  code: 'var(--color-code)',
  file: 'var(--color-file)',
  symbol: 'var(--color-symbol)',
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
      {kind === 'code' && (
        <path
          d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"
          fill="none"
          stroke={c}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === 'file' && (
        <>
          <path
            d="M4 1.8h5l3 3v9.4H4z"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M9 1.8v3h3" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />
        </>
      )}
      {kind === 'symbol' && (
        <path
          d="M10.5 3.2c-1.6-.5-2.6.3-2.9 1.9L7 8.5c-.3 1.6-1.2 2.4-2.8 1.9M5 6.6h5"
          fill="none"
          stroke={c}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export const KIND_LABEL: Record<OrgNodeKind, string> = {
  repo: 'Repository',
  service: 'Service',
  endpoint: 'Endpoint',
  code: 'Code',
  file: 'File / module',
  symbol: 'Symbol',
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
