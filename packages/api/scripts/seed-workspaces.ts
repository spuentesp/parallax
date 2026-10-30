// Seed the Parallax DB with EXACTLY the two NVIDIA demo workspaces:
// - Cluster A: OpenShell RPC Stack
// - Cluster B: NeMo Agent Toolkit HTTP Stack
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

const LAIN_URL = process.env.LAIN_URL ?? 'http://127.0.0.1:9999/mcp';
const CLUSTER_A_LAIN = process.env.CLUSTER_A_LAIN_URL ?? LAIN_URL;
const CLUSTER_B_LAIN = process.env.CLUSTER_B_LAIN_URL ?? LAIN_URL;

const WORKSPACES: SeedWorkspace[] = [
  {
    id: 'ws_cluster_a',
    name: 'Cluster A: OpenShell RPC Stack',
    description:
      'OpenShell gRPC proto surface joined with Python SDK and NeMo-Fabric / NemoClaw cross-repo consumers.',
    lainUrl: CLUSTER_A_LAIN,
    repos: [
      {
        id: 'repo_openshell',
        uri: 'https://github.com/NVIDIA/OpenShell.git',
        sha: 'cc9995438f3fa509bb5400d32ec4b2bdc38cbc1d',
        local: './test-repos/nvidia/OpenShell',
      },
      {
        id: 'repo_nemo_fabric',
        uri: 'https://github.com/NVIDIA/NeMo-Fabric.git',
        sha: '4fdf65a4b4c96024327501ae28243f2d206e7ec7',
        local: './test-repos/nvidia/NeMo-Fabric',
      },
      {
        id: 'repo_nemoclaw',
        uri: 'https://github.com/NVIDIA/NemoClaw.git',
        sha: 'de00977585d04f3bac7b090a0870b0d2dca4972d',
        local: './test-repos/nvidia/NemoClaw',
      },
    ],
  },
  {
    id: 'ws_cluster_b',
    name: 'Cluster B: NeMo Agent Toolkit HTTP Stack',
    description:
      'NeMo Agent Toolkit HTTP & WebSocket runtime endpoints, Next.js API routes, and UI reverse proxy.',
    lainUrl: CLUSTER_B_LAIN,
    repos: [
      {
        id: 'repo_nat',
        uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit.git',
        sha: '3ec11d6f733f53ab0a0c3e7b3a7a3bb7cbf70db8',
        local: './test-repos/nvidia/NeMo-Agent-Toolkit',
      },
      {
        id: 'repo_nat_ui',
        uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit-UI.git',
        sha: '41cb8cf843091a24bd06d0a5f844a3cb824049d8',
        local: './test-repos/nvidia/NeMo-Agent-Toolkit-UI',
      },
      {
        id: 'repo_nat_examples',
        uri: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples.git',
        sha: 'eadbb7573b9ba12c01a9df85c601a32a886d7b25',
        local: './test-repos/nvidia/NeMo-Agent-Toolkit-Examples',
      },
    ],
  },
];

function seed(): void {
  const dbPath = resolve(process.env.DATABASE_PATH ?? './data/parallax.db');
  const db = new Database(dbPath);
  runMigrations(db, resolve(process.cwd(), 'drizzle'));

  // Ensure ONLY ws_cluster_a and ws_cluster_b exist in database
  db.prepare(`DELETE FROM repo WHERE workspace_id NOT IN ('ws_cluster_a', 'ws_cluster_b')`).run();
  db.prepare(`DELETE FROM workspace WHERE id NOT IN ('ws_cluster_a', 'ws_cluster_b')`).run();

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
