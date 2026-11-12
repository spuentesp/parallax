import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LogoMark } from './Logo.js';

describe('LogoMark', () => {
  afterEach(cleanup);

  it('is announced as Parallax and keeps the brand green on the graph', () => {
    const { container } = render(<LogoMark size={40} />);
    const img = screen.getByRole('img', { name: 'Parallax' });
    expect(img.getAttribute('width')).toBe('40');
    // El verde del logo (#76b900): 5 nodos y 2 trazos del grafo en P.
    expect(container.querySelectorAll('circle[fill="#76b900"]')).toHaveLength(5);
    expect(container.querySelectorAll('path[stroke="#76b900"]')).toHaveLength(2);
  });

  it('is hidden from screen readers when it sits next to the word Parallax', () => {
    const { container } = render(<LogoMark decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('slabs follow the theme tokens, so the stack does not vanish on the dark background', () => {
    const { container } = render(<LogoMark />);
    const fills = [...container.querySelectorAll('path')]
      .map((p) => (p as SVGPathElement).style.fill)
      .filter(Boolean);
    expect(fills.every((f) => f.startsWith('var(--logo-slab-'))).toBe(true);
  });
});
