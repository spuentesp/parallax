import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Page, paginate } from '../../src/lain/evidence.js';

// Oráculo: paginar es cortar. La concatenación de todas las páginas debe
// reconstruir la lista original (contrato de cursor completo).
describe('paginate properties', () => {
  it('walking every page via nextCursor reproduces the input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.integer({ min: 1, max: 25 }),
        (items: number[], limit: number) => {
          const collected: number[] = [];
          let cursor: string | null = '0';
          let guard = 0;
          while (cursor !== null && guard < 100) {
            const page: Page<number> = paginate<number>(items, Number(cursor), limit);
            collected.push(...page.items);
            expect(page.items.length).toBeLessThanOrEqual(limit);
            expect(page.truncated).toBe(page.nextCursor !== null);
            cursor = page.nextCursor;
            guard += 1;
          }
          expect(collected).toEqual(items);
        },
      ),
      { numRuns: 50, endOnFailure: true },
    );
  });

  it('offset beyond the end yields an empty, non-truncated page', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 10 }), (items: number[]) => {
        const page: Page<number> = paginate<number>(items, items.length + 5, 10);
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeNull();
        expect(page.truncated).toBe(false);
      }),
      { numRuns: 50, endOnFailure: true },
    );
  });
});
