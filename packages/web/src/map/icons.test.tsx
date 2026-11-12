import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EdgeSwatch, KIND_LABEL, KindIcon } from './icons.js';

afterEach(cleanup);

const KINDS = ['repo', 'service', 'endpoint', 'code', 'file', 'symbol'] as const;

describe('KindIcon', () => {
  it('names itself by kind and paints with that kind’s theme token, never a hex', () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<KindIcon kind={kind} />);
      const svg = container.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe(kind);
      expect(svg.querySelector('title')?.textContent).toBe(kind);
      const painted = Array.from(svg.querySelectorAll('[stroke],[fill]')).map(
        (e) => e.getAttribute('stroke') ?? e.getAttribute('fill'),
      );
      expect(painted.some((c) => c === `var(--color-${kind})`)).toBe(true);
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
      unmount();
    }
  });

  it('size controls width and height (default 14)', () => {
    const { container } = render(<KindIcon kind="repo" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14');
    cleanup();
    const big = render(<KindIcon kind="repo" size={22} />);
    const svg = big.container.querySelector('svg');
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['22', '22']);
  });

  it('each kind draws a distinct glyph', () => {
    const shapes = KINDS.map((k) => {
      const { container, unmount } = render(<KindIcon kind={k} />);
      const html =
        container.querySelector('svg')?.innerHTML.replace(/<title>.*?<\/title>/, '') ?? '';
      unmount();
      return html;
    });
    expect(new Set(shapes).size).toBe(KINDS.length);
  });

  it('has a human label for every kind', () => {
    expect(KIND_LABEL).toEqual({
      repo: 'Repository',
      service: 'Service',
      group: 'Contract group',
      endpoint: 'Endpoint',
      code: 'Code',
      file: 'File / module',
      symbol: 'Symbol',
    });
  });
});

describe('EdgeSwatch', () => {
  it('deterministic is a solid teal line, inferred a dashed rose one', () => {
    const det = render(<EdgeSwatch provenance="deterministic" />).container.querySelector(
      'line',
    ) as SVGLineElement;
    expect(det.getAttribute('stroke')).toBe('var(--color-deterministic)');
    expect(det.getAttribute('stroke-dasharray')).toBeNull();
    cleanup();
    const inf = render(<EdgeSwatch provenance="inferred" />).container.querySelector(
      'line',
    ) as SVGLineElement;
    expect(inf.getAttribute('stroke')).toBe('var(--color-inferred)');
    expect(inf.getAttribute('stroke-dasharray')).toBe('5 3');
  });

  it('is decorative, and scales its line and arrow with the width', () => {
    const { container } = render(<EdgeSwatch provenance="inferred" width={40} />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('40');
    expect(svg.getAttribute('viewBox')).toBe('0 0 40 8');
    expect(container.querySelector('line')?.getAttribute('x2')).toBe('34');
    expect(container.querySelector('path')?.getAttribute('d')).toBe('M33 1l5 3-5 3z');
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('var(--color-inferred)');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('defaults to 28 wide', () => {
    const { container } = render(<EdgeSwatch provenance="deterministic" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('28');
  });
});
