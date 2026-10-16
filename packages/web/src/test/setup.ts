// jsdom does not provide canvas or ResizeObserver; reagraph/three.js need both.
// Mock the minimum surface so components can initialize in tests.

/* biome-ignore-all lint/suspicious/noExplicitAny: test-only mock */
/* biome-ignore-all lint/correctness/noUnusedImports: polyfill */

import { afterAll, beforeEach } from 'vitest';

if (typeof HTMLCanvasElement !== 'undefined') {
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    fillRect: () => {},
    clearRect: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: 'srgb',
    }),
    putImageData: () => {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: 'srgb',
    }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({
      width: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
  });
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
