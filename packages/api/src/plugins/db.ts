import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import fp from 'fastify-plugin';
import { runMigrations } from '../db/migrate.js';
import * as schema from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: BetterSQLite3Database<typeof schema>;
    config: import('../config.js').AppConfig;
    lain: import('../lain-adapter/types.js').LainAdapter;
    authToken?: import('../config.js').AuthToken;
  }
  interface FastifyRequest {
    authToken?: import('../config.js').AuthToken;
  }
}

export default fp(
  async (fastify) => {
    const dbPath = resolve(fastify.config?.databasePath ?? "./data/parallax.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    runMigrations(sqlite, resolve(process.cwd(), 'drizzle'));

    const db = drizzle(sqlite, { schema });
    fastify.decorate('db', db);
    fastify.addHook('onClose', async () => {
      sqlite.close();
    });
  },
  { name: 'db' },
);
