// Seed the Parallax DB with the demo workspaces (one workspace = one org).
//
// Saleor is multi-repo (3 repos, GraphQL). Online Boutique is a monorepo with
// 11 gRPC services. Both are already cloned under test-repos/ and indexed by
// LAIN, so `lainUrl` points at the per-workspace lain server.
//
// Usage: DATABASE_PATH=/tmp/parallax.db pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts

import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';

interface SeedRepo {
  id: string;
  uri: string;
  sha: string;
  local: string;
}

interface SeedWorkspace {
  id: string;
  name: string;
  description: string;
  lainUrl: string;
  repos: SeedRepo[];
}

const SALEOR_LAIN = process.env.SALEOR_LAIN_URL ?? 'http://localhost:9999/mcp';
const BOUTIQUE_LAIN = process.env.BOUTIQUE_LAIN_URL ?? 'http://localhost:9998/mcp';

const WORKSPACES: SeedWorkspace[] = [
  {
    id: 'ws_saleor',
    name: 'Saleor',
    description:
      'E-commerce platform: API + Dashboard + Storefront. Three repos, GraphQL contracts.',
    lainUrl: SALEOR_LAIN,
    repos: [
      {
        id: 'repo_saleor_api',
        uri: 'https://github.com/saleor/saleor.git',
        sha: 'a31848549f5dc5843fe9e66422bf34a915559ee5',
        local: './test-repos/saleor',
      },
      {
        id: 'repo_saleor_dashboard',
        uri: 'https://github.com/saleor/saleor-dashboard.git',
        sha: 'e34cd91db8cd51ed9cbd69374b4f3bdb61c0285f',
        local: './test-repos/saleor-dashboard',
      },
      {
        id: 'repo_saleor_storefront',
        uri: 'https://github.com/saleor/storefront.git',
        sha: '05641e1fa8b87a6ba0a403d2d323164872422fa5',
        local: './test-repos/storefront',
      },
    ],
  },
  {
    id: 'ws_boutique',
    name: 'Online Boutique',
    description:
      'Google microservices demo: 11 services in one monorepo, gRPC/Protobuf contracts.',
    lainUrl: BOUTIQUE_LAIN,
    repos: [
      {
        id: 'repo_microservices_demo',
        uri: 'https://github.com/GoogleCloudPlatform/microservices-demo.git',
        sha: '38e7348eb289eb5b87c0c6e8cb19ced0449dc389',
        local: './test-repos/microservices-demo',
      },
    ],
  },
];

function seed(): void {
  const dbPath = resolve(process.env.DATABASE_PATH ?? './data/parallax.db');
  const db = new Database(dbPath);
  runMigrations(db, resolve(process.cwd(), 'drizzle'));

  const insertWs = db.prepare(
    `INSERT OR REPLACE INTO workspace (id, name, description, lain_url, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRepo = db.prepare(
    `INSERT OR REPLACE INTO repo (id, workspace_id, uri, sha, local, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const now = Date.now();
  for (const ws of WORKSPACES) {
    insertWs.run(ws.id, ws.name, ws.description, ws.lainUrl, now);
    for (const repo of ws.repos) {
      insertRepo.run(repo.id, ws.id, repo.uri, repo.sha, repo.local, now);
    }
    console.log(`✓ ${ws.name}: ${ws.repos.length} repo(s) → ${ws.lainUrl}`);
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM workspace').get() as { n: number };
  const repoCount = db.prepare('SELECT COUNT(*) AS n FROM repo').get() as { n: number };
  console.log(`\nDB ${dbPath}: ${count.n} workspaces, ${repoCount.n} repos`);
  db.close();
}

seed();
