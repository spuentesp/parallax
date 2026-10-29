// El diff de un PR → líneas cambiadas en la numeración del código BASE (que es lo que indexa
// el motor): lo borrado es su propia línea vieja, lo insertado se ancla a la línea de arriba.

import { describe, expect, it } from 'vitest';
import { changedLines } from '../src/pr-review/diff.js';

describe('changedLines', () => {
  it('maps removed and modified lines to their OLD line numbers', () => {
    const patch = [
      '@@ -10,6 +10,6 @@ def stock_qs_select_for_update():',
      ' def a():',
      '     x = 1',
      '-    y = 2',
      '+    y = 3',
      '     z = 4',
      ' ',
    ].join('\n');
    expect(changedLines(patch)).toEqual([
      { oldLine: 12, kind: 'removed', startsNewDefinition: false },
      // la línea nueva se ancla justo antes: a la línea vieja 11 (después de borrar la 12 se
      // vuelve a anclar en la 12; lo que importa es que cae dentro de la misma función)
      { oldLine: 12, kind: 'added', startsNewDefinition: false },
    ]);
  });

  it('anchors a pure insertion to the old line above it', () => {
    const patch = ['@@ -5,3 +5,4 @@', ' a', ' b', '+inserted', ' c'].join('\n');
    expect(changedLines(patch)).toEqual([
      { oldLine: 6, kind: 'added', startsNewDefinition: false },
    ]);
  });

  it('an insertion at the top of the file belongs to module scope (line 0)', () => {
    const patch = ['@@ -1,2 +1,3 @@', '+import os', ' a', ' b'].join('\n');
    expect(changedLines(patch)).toEqual([
      { oldLine: 0, kind: 'added', startsNewDefinition: false },
    ]);
  });

  it('recognises an added block that starts a new definition, even behind a decorator', () => {
    const py = [
      '@@ -20,2 +20,6 @@',
      ' return x',
      ' ',
      '+@cache',
      '+def fresh(a):',
      '+    return a',
    ].join('\n');
    expect(changedLines(py)).toEqual([{ oldLine: 21, kind: 'added', startsNewDefinition: true }]);
    const ts = [
      '@@ -3,1 +3,4 @@',
      ' end',
      '+export async function build() {',
      '+  return 1;',
      '+}',
    ].join('\n');
    expect(changedLines(ts)[0]?.startsNewDefinition).toBe(true);
    const arrow = ['@@ -3,1 +3,2 @@', ' end', '+export const load = async (id: string) => {'].join(
      '\n',
    );
    expect(changedLines(arrow)[0]?.startsNewDefinition).toBe(true);
  });

  it('an added block inside a function body is not a new definition', () => {
    const patch = [
      '@@ -8,3 +8,4 @@',
      ' def f():',
      '     a = 1',
      '+    b = 2',
      '     return a',
    ].join('\n');
    expect(changedLines(patch)).toEqual([
      { oldLine: 9, kind: 'added', startsNewDefinition: false },
    ]);
  });

  it('keeps old-line numbering across several hunks and ignores "no newline" markers', () => {
    const patch = [
      '@@ -3,2 +3,2 @@',
      '-a',
      '+A',
      ' b',
      '@@ -40,2 +40,1 @@',
      ' keep',
      '-gone',
      '\\ No newline at end of file',
    ].join('\n');
    expect(changedLines(patch).map((c) => [c.kind, c.oldLine])).toEqual([
      ['removed', 3],
      ['added', 3],
      ['removed', 41],
    ]);
  });

  it('a missing or empty patch (binary, too large) changes nothing', () => {
    expect(changedLines(undefined)).toEqual([]);
    expect(changedLines('')).toEqual([]);
  });
});
