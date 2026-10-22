import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

// Applied migrations are recorded so every file runs exactly once. Plain SQL
// migrations (ALTER TABLE ADD COLUMN, …) are not idempotent on their own.
export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );
  const applied = new Set(
    db
      .prepare<unknown[], { name: string }>('SELECT name FROM schema_migrations')
      .all()
      .map((r: { name: string }) => r.name),
  );
  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    record.run(file, Date.now());
  }
}

export function tableNames(db: Database.Database): string[] {
  return db
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r: { name: string }) => r.name);
}
