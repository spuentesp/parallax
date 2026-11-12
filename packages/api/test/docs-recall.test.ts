// Recall@k de la recuperación de documentación sobre un repo de fixture. El índice se
// construye por el camino real (readDocs → indexRepo) y se busca con searchDocs: nada se
// inserta a mano. El umbral es el piso medido; si una mejora sube el número, se sube el piso.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { ftsQuery, indexRepo, readDocs, searchDocs } from '../src/docs/index.js';
import { type RecallCase, recallAtK } from '../src/docs/recall.js';
import { DOC_STOPWORDS } from '../src/docs/service.js';

const FILES: Record<string, string> = {
  'docs/adr/0004-gift-card-lock.md': `# 4. Gift card balance row lock

## Decision

Balance adjustments take select_for_update inside a transaction, because two checkouts raced.
`,
  'docs/adr/0007-webhook-retries.md': `# 7. Webhook delivery retries

## Decision

Failed webhook deliveries are retried with exponential backoff through the task queue.
`,
  'docs/architecture/payments.md': `# Payments architecture

## Gateways

Each payment gateway is a plugin that implements the PaymentInterface and handles capture and refund.
`,
  'CONTRIBUTING.md': `# Contributing

## Running the tests

Run pytest from the repository root; the CI also runs the type checker.
`,
  'AGENTS.md': `# Agent rules

## Conventions

Never hand-insert rows to fabricate state; use the real write path. Name migrations by number.
`,
  'README.md': `# Shop

A storefront and API for orders.
`,
};

const CASES: RecallCase[] = [
  {
    question: 'why do gift card balance adjustments use a lock',
    expect: ['docs/adr/0004-gift-card-lock.md'],
  },
  {
    question: 'how are failed webhook deliveries retried',
    expect: ['docs/adr/0007-webhook-retries.md'],
  },
  {
    question: 'how does a payment gateway plugin handle refunds',
    expect: ['docs/architecture/payments.md'],
  },
  { question: 'how do I run the tests', expect: ['CONTRIBUTING.md'] },
  { question: 'what conventions apply to migrations', expect: ['AGENTS.md'] },
  // El vocabulario del código no es el de la documentación: identificadores en la pregunta.
  {
    question: 'why does giftCardBalance take select_for_update',
    expect: ['docs/adr/0004-gift-card-lock.md'],
  },
  {
    question: 'what does retryWebhookDelivery do on failure',
    expect: ['docs/adr/0007-webhook-retries.md'],
  },
  {
    question: 'where is PaymentGateway.capture documented',
    expect: ['docs/architecture/payments.md'],
  },
];

describe('docs retrieval recall@k', () => {
  let dir: string;
  let db: Database.Database;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-recall-'));
    for (const [rel, text] of Object.entries(FILES)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    db = new Database(':memory:');
    runMigrations(db, resolve(process.cwd(), 'drizzle'));
    indexRepo(db, 'ws', 'shop', readDocs(dir), 'abc');
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const search = (q: string, o: { repo?: string; limit: number }) =>
    searchDocs(db, 'ws', q, DOC_STOPWORDS, o);

  it('finds the expected document in the top 3 for every question', () => {
    const report = recallAtK(search, CASES, 3);
    expect(report.misses).toEqual([]);
    expect(report.recall).toBe(1);
  });

  it('splits code identifiers into the words the documentation uses', () => {
    const q = ftsQuery('why does giftCardBalance take select_for_update', DOC_STOPWORDS) ?? '';
    for (const w of ['gift', 'card', 'balance', 'select', 'update']) expect(q).toContain(`"${w}"*`);
  });
});
