// Seed the Fly demo database with the two NVIDIA workspaces (one federation, two views of it).
// Runs at every boot: INSERT OR REPLACE, so it is idempotent and keeps the volume's other data.
//   DATABASE_PATH=/data/parallax.db LAIN_URL=http://127.0.0.1:9999/mcp tsx scripts/seed-nvidia-demo.ts

import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';

const LAIN_URL = process.env.LAIN_URL ?? 'http://127.0.0.1:9999/mcp';
const CLUSTER_A_URL = process.env.CLUSTER_A_LAIN_URL ?? LAIN_URL;
const CLUSTER_B_URL = process.env.CLUSTER_B_LAIN_URL ?? LAIN_URL;
const gh = (name: string) => `https://github.com/NVIDIA/${name}.git`;

const WORKSPACES = [
  {
    id: 'ws_cluster_a',
    lainUrl: CLUSTER_A_URL,
    name: 'Cluster A: OpenShell RPC Stack',
    description:
      'OpenShell gRPC proto surface joined with the Python SDK and the NeMo-Fabric / NemoClaw consumers.',
    repos: [
      ['OpenShell', 'd4e32263eb4554c46c5bae702acada2f4af03eb0'],
      ['NeMo-Fabric', '4fdf65a4b4c96024327501ae28243f2d206e7ec7'],
      ['NemoClaw', '37f1e4cb9942a3dc05c0c76995f86624261bc7b1'],
    ],
  },
  {
    id: 'ws_cluster_b',
    lainUrl: CLUSTER_B_URL,
    name: 'Cluster B: NeMo Agent Toolkit HTTP Stack',
    description:
      'NeMo Agent Toolkit HTTP and WebSocket endpoints, the Next.js API routes and the UI reverse proxy.',
    repos: [
      ['NeMo-Agent-Toolkit', '3ec11d6f733f53ab0a0c3e7b3a7a3bb7cbf70db8'],
      ['NeMo-Agent-Toolkit-UI', '41cb8cf843091a24bd06d0a5f844a3cb824049d8'],
      ['NeMo-Agent-Toolkit-Examples', 'eadbb7573b9ba12c01a9df85c601a32a886d7b25'],
    ],
  },
] as const;

const db = new Database(resolve(process.env.DATABASE_PATH ?? './data/parallax.db'));
runMigrations(db, resolve(process.cwd(), 'drizzle'));
const ids = WORKSPACES.map((w) => w.id);
const marks = ids.map(() => '?').join(',');
db.prepare(`DELETE FROM repo WHERE workspace_id NOT IN (${marks})`).run(...ids);
db.prepare(`DELETE FROM workspace WHERE id NOT IN (${marks})`).run(...ids);
const now = Date.now();
for (const ws of WORKSPACES) {
  db.prepare(
    'INSERT OR REPLACE INTO workspace (id, name, description, lain_url, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ws.id, ws.name, ws.description, ws.lainUrl, now);
  for (const [name, sha] of ws.repos) {
    db.prepare(
      'INSERT OR REPLACE INTO repo (id, workspace_id, uri, sha, local, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(name, ws.id, gh(name), sha, `/repos/${name}`, now);
  }
  console.log(`✓ ${ws.name}: ${ws.repos.length} repos`);
}
db.close();
