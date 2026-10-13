import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { tableNames } from '../src/db/migrate.js';

describe('db migrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parallax-db-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the seven tables on a fresh database', () => {
    const db = new Database(join(dir, 't.db'));
    db.pragma('foreign_keys = ON');
    const init = readFileSync(
      new URL('../drizzle/0000_init.sql', import.meta.url),
      'utf8',
    );
    db.exec(init);
    const names = tableNames(db);
    expect(names).toEqual(
      expect.arrayContaining([
        'org',
        'assessment',
        'explanation',
        'evidence',
        'job_step',
        'event',
        'publication',
      ]),
    );
    db.close();
  });
});
