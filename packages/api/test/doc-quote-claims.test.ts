// Una cita de la documentación se comprueba contra la SECCIÓN indexada del
// checkout: la frase tiene que aparecer literalmente en esa sección. El índice
// se construye con el camino real (readDocs → indexRepo), nunca a mano.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Claim, verifyClaims } from '../src/agent/claims.js';
import { runMigrations } from '../src/db/migrate.js';
import { findDocSections, indexRepo, readDocs } from '../src/docs/index.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const ADR = `# 4. Adjust gift card balance with a row lock

## Context

Two checkouts spending the same gift card raced and the balance went negative.

## Decision

Balance adjustments take select_for_update inside a transaction.
`;

const WS = 'ws';

describe('doc_quote claims', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-docquote-'));
    mkdirSync(join(dir, 'docs/adr'), { recursive: true });
    writeFileSync(join(dir, 'docs/adr/0004-gift-card-lock.md'), ADR);
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
    // El índice se llena por el camino real: se lee el checkout y se indexa.
    indexRepo(db, WS, 'saleor', readDocs(dir), 'abc123');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const deps = (lain: LainAdapter, withIndex = true) => ({
    lain,
    view: 'live',
    resolveService: async () => null,
    validateRefs: async () => ({ accepted: [], receipts: [], rejected: [] }),
    hasRepo: async () => true,
    ...(withIndex
      ? {
          docSection: (repo: string, path: string, section: string) =>
            findDocSections(db, WS, repo, path, section),
        }
      : {}),
  });

  const quote = (over: object = {}) =>
    Claim.parse({
      kind: 'doc_quote',
      repo: 'saleor',
      path: 'docs/adr/0004-gift-card-lock.md',
      section: '4. Adjust gift card balance with a row lock › Decision',
      quote: 'select_for_update inside a transaction',
      text: 'the ADR says the balance is adjusted with a row lock',
      ...over,
    });

  it('VERIFIED when the quoted phrase is in the section the claim names', async () => {
    const [r] = await verifyClaims([quote()], deps(createLainMock() as LainAdapter));
    expect(r?.verdict).toBe('verified');
    expect(r?.reason).toMatch(/contains the quoted phrase/);
  });

  it('the phrase must be IN THAT SECTION, not somewhere in the file', async () => {
    // La frase está en el archivo, pero en la sección "Context", no en "Decision".
    const [r] = await verifyClaims(
      [
        quote({
          quote: 'the balance went negative',
          section: '4. Adjust gift card balance with a row lock › Decision',
        }),
      ],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('contradicted');
    expect(r?.reason).toMatch(/does not contain the quoted phrase/);
  });

  it('CONTRADICTED when the file is not a documentation file of the index', async () => {
    const [r] = await verifyClaims(
      [quote({ path: 'docs/adr/9999-nope.md' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('contradicted');
    expect(r?.reason).toMatch(/not a documentation file in the indexed checkout/);
  });

  it('UNVERIFIABLE when the section does not exist: the engine says which do', async () => {
    const [r] = await verifyClaims(
      [quote({ section: 'Decision' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toMatch(/has no section "Decision"/);
    // Y dice cuáles hay, para que el modelo lo corrija.
    expect(r?.reason).toMatch(/Decision/);
  });

  it('UNVERIFIABLE without a documentation index: never a guess', async () => {
    const [r] = await verifyClaims([quote()], deps(createLainMock() as LainAdapter, false));
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toMatch(/no documentation index/);
  });

  it('the title is matched without case and without stray spaces', async () => {
    const [r] = await verifyClaims(
      [quote({ section: '  4. adjust gift card balance with a row lock › decision ' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('verified');
  });

  it('the phrase is matched across a line break, but not across different words', async () => {
    const inContext = {
      section: '4. Adjust gift card balance with a row lock › Context',
    };
    const [r] = await verifyClaims(
      [quote({ ...inContext, quote: 'two checkouts spending the same gift card raced' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('verified');
    const [w] = await verifyClaims(
      [quote({ ...inContext, quote: 'two checkouts spending a gift card raced' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(w?.verdict).toBe('contradicted');
  });

  it('a contradicted quote carries back what the engine really read', async () => {
    const [r] = await verifyClaims(
      [quote({ quote: 'take a row lock on the gift card' })],
      deps(createLainMock() as LainAdapter),
    );
    expect(r?.verdict).toBe('contradicted');
    expect(r?.readback).toContain('select_for_update inside a transaction');
  });

  it('the schema demands what makes it checkable: repo, path, section and quote', () => {
    const base = { kind: 'doc_quote', repo: 'r', path: 'p', section: 's', text: 't' };
    expect(Claim.safeParse({ ...base, quote: 'x' }).success).toBe(true);
    expect(Claim.safeParse({ ...base }).success).toBe(false); // sin quote
    expect(Claim.safeParse({ ...base, quote: 'x', extra: 1 }).success).toBe(false);
  });
});
