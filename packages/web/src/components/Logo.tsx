import type * as React from 'react';

// La marca de Parallax: un bloque isométrico (la arquitectura) con un grafo en forma de P
// encima. Verde = nodos afectados, gris = sin impacto. Los verdes y el gris de los nodos son
// fijos (son la marca); las losas se aclaran en el tema oscuro (ver --logo-* en index.css)
// porque el original, casi negro, desaparece sobre un fondo casi negro.
// El maestro está en design/logo/parallax-logo.svg; public/logo.svg es la copia que sirve la web.
export function LogoMark({
  size = 32,
  title = 'Parallax',
  decorative = false,
  className,
}: {
  size?: number;
  title?: string;
  /** Junto a un texto que ya dice "Parallax": el lector de pantalla no lo repite. */
  decorative?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <title>{title}</title>
      <path d="M 10 55 L 50 75 L 50 83 L 10 63 Z" style={{ fill: 'var(--logo-slab-a)' }} />
      <path d="M 50 75 L 90 55 L 90 63 L 50 83 Z" style={{ fill: 'var(--logo-slab-b)' }} />
      <path d="M 50 35 L 90 55 L 50 75 L 10 55 Z" style={{ fill: 'var(--logo-slab-a)' }} />
      <path d="M 10 40 L 50 60 L 50 68 L 10 48 Z" style={{ fill: 'var(--logo-slab-a)' }} />
      <path d="M 50 60 L 90 40 L 90 48 L 50 68 Z" style={{ fill: 'var(--logo-slab-b)' }} />
      <path d="M 50 20 L 90 40 L 50 60 L 10 40 Z" style={{ fill: 'var(--logo-slab-top)' }} />
      <path
        d="M 30 63 L 50 73 L 70 63"
        fill="none"
        stroke="#6b6b6b"
        strokeWidth="2.5"
        strokeDasharray="4 2"
        strokeLinejoin="round"
      />
      <path
        d="M 30 30 L 30 63"
        fill="none"
        stroke="#76b900"
        strokeWidth="2.5"
        strokeDasharray="4 2"
      />
      <path
        d="M 50 20 L 70 30 L 50 40 L 30 30 Z"
        fill="none"
        stroke="#76b900"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="73" r="3.5" fill="#6b6b6b" />
      <circle cx="70" cy="63" r="3.5" fill="#6b6b6b" />
      <circle cx="30" cy="63" r="3.5" fill="#76b900" />
      <circle cx="30" cy="30" r="3.5" fill="#76b900" />
      <circle cx="50" cy="40" r="3.5" fill="#76b900" />
      <circle cx="70" cy="30" r="3.5" fill="#76b900" />
      <circle cx="50" cy="20" r="3.5" fill="#76b900" />
    </svg>
  );
}
