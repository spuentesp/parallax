import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  const init = readFileSync(join(migrationsDir, '0000_init.sql'), 'utf8');
  db.exec(init);
}

export function tableNames(db: Database.Database): string[] {
  return db
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r: { name: string }) => r.name);
}
