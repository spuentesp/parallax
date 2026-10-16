import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Política anti reward-hacking (Write-Then-Read): la suite held-out es el
// oráculo y está prohibido fabricar a mano el estado que se va a leer. El
// estado bajo test (assessment/evidence/explanation/jobStep/event) debe llegar
// por la ruta de escritura real (worker.create/run). Insertar infraestructura
// (workspace) sí está permitido.
const STATE_TABLES = ['assessment', 'evidence', 'explanation', 'jobStep', 'event'];
const HELDOUT_DIR = join(__dirname, '../../api/test-heldout');

function heldoutFiles(): string[] {
  return readdirSync(HELDOUT_DIR).filter((f) => f.endsWith('.test.ts'));
}

function directStateInserts(source: string): string[] {
  return STATE_TABLES.filter((table) => {
    const pattern = new RegExp(`insert\\(schema\\.${table}\\)`);
    return pattern.test(source);
  });
}

describe('repo policy: held-out suite cannot fabricate the state it reads', () => {
  it('no test-heldout file inserts directly into state tables', () => {
    const violations: string[] = [];
    for (const file of heldoutFiles()) {
      const source = readFileSync(join(HELDOUT_DIR, file), 'utf8');
      for (const table of directStateInserts(source)) {
        violations.push(`${file} inserts into schema.${table}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
