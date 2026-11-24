import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { measure } from './layout.js';
import { buildStyle } from './MapCanvas.js';

// El layout reserva a cada hoja su tamaño medido; si el estilo la dibuja más
// grande (p. ej. por el padding de contenedor), las hojas vecinas se montan.
describe('collapsed containers render at the size the layout reserved', () => {
  for (const kind of ['repo', 'service', 'group'] as const) {
    it(`${kind} without children`, () => {
      const size = measure('some-name', kind);
      const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        elements: [
          {
            data: { id: 'n', w: size.w, h: size.h, tw: size.w - 12, label: 'some-name' },
            classes: kind,
          },
        ],
        style: buildStyle(),
      });
      const n = cy.getElementById('n');
      // El borde añade a lo sumo un par de píxeles; el padding de contenedor, decenas.
      expect(n.outerWidth()).toBeLessThanOrEqual(size.w + 4);
      expect(n.outerHeight()).toBeLessThanOrEqual(size.h + 4);
    });
  }
});
