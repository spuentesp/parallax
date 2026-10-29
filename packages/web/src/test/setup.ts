// jsdom does not provide canvas or ResizeObserver; cytoscape needs both.
// Mock the minimum surface so components can initialize in tests.

/* biome-ignore-all lint/suspicious/noExplicitAny: test-only mock */
/* biome-ignore-all lint/correctness/noUnusedImports: polyfill */

import { afterAll, beforeEach } from 'vitest';

// Contexto 2D inerte: cualquier método de dibujo (arcTo, bezierCurveTo,
// setLineDash…) es un no-op, y sólo los que devuelven datos tienen forma. Una
// lista fija se queda corta en cuanto el lienzo dibuja una forma nueva.
if (typeof HTMLCanvasElement !== 'undefined') {
  const data = {
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: 'srgb',
    }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: 'srgb',
    }),
    measureText: () => ({
      width: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => ({}),
    getLineDash: () => [],
    isPointInPath: () => false,
  } as Record<string, unknown>;
  (HTMLCanvasElement.prototype as any).getContext = () => {
    const props: Record<string, unknown> = {};
    return new Proxy(props, {
      get: (target, key: string) =>
        key in data ? data[key] : key in target ? target[key] : () => {},
      set: (target, key: string, value) => {
        target[key] = value;
        return true;
      },
    });
  };
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

// Borde de red para los tests: MSW intercepta fetch. Un request sin handler
// falla el test (regla AGENTS.md #2: mock solo en el borde de proceso).
import { server } from './msw.js';

server.listen({ onUnhandledRequest: 'error' });
beforeEach(() => server.resetHandlers());
afterAll(() => server.close());

// La memoria de navegación (último workspace, mapa, hilo) no debe pasar de un test a otro.
import { afterEach } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
