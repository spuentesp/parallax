import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

// Política anti reward-hacking (mock solo en el borde): ningún test puede
// vi.mock un módulo interno del repo (hooks, stores, services) — un mock
// interno es exactamente cómo se esconde el feature isolation. El borde de
// proceso (red/transporte) se intercepta con MSW o se inyecta; los paquetes
// externos (p.ej. reagraph) sí se mockean.
const PACKAGES_DIR = join(__dirname, '../..');
const INTERNAL_SPEC_PREFIXES = ['.', '@parallax/'];

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') out.push(...tsFiles(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function testSources(): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const root = join(PACKAGES_DIR, pkg.name);
    out.push(...tsFiles(join(root, 'test')), ...tsFiles(join(root, 'test-heldout')));
    for (const f of tsFiles(join(root, 'src'))) {
      if (/\.(test|spec)\.(ts|tsx)$/.test(f)) out.push(f);
    }
  }
  return out;
}

function internalMocks(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/vi\.(?:do)?mock\(\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1] ?? '';
    if (INTERNAL_SPEC_PREFIXES.some((p) => spec.startsWith(p))) hits.push(spec);
  }
  return hits;
}

describe('repo policy: tests mock only at the process edge', () => {
  it('no test file vi.mocks a repo-internal module (hooks, stores, services)', () => {
    const violations: string[] = [];
    for (const file of testSources()) {
      const source = readFileSync(file, 'utf8');
      for (const spec of internalMocks(source)) {
        violations.push(`${relative(PACKAGES_DIR, file)} mocks internal module ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
