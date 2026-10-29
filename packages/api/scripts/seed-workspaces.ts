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

const LAIN_URL = process.env.LAIN_URL ?? 'http://host.docker.internal:9999/mcp';
const CLUSTER_A_LAIN = process.env.CLUSTER_A_LAIN_URL ?? LAIN_URL;
const CLUSTER_B_LAIN = process.env.CLUSTER_B_LAIN_URL ?? LAIN_URL;
const SALEOR_LAIN = process.env.SALEOR_LAIN_URL ?? LAIN_URL;
const BOUTIQUE_LAIN = process.env.BOUTIQUE_LAIN_URL ?? 'http://localhost:9998/mcp';
const FIXTURE_LAIN = process.env.FIXTURE_LAIN_URL ?? 'http://localhost:9997/mcp';

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
  {
    id: 'ws_fixture',
    name: 'Contracts Fixture',
    description:
      'Deterministic 4-repo fixture (orders/billing/reports/platform) with ground truth for P01–P10.',
    lainUrl: FIXTURE_LAIN,
    repos: [
      {
        id: 'repo_fixture_orders',
        uri: 'fixture://contracts/orders',
        sha: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
        local: './test-repos/contracts-fixture/orders',
      },
      {
        id: 'repo_fixture_billing',
        uri: 'fixture://contracts/billing',
        sha: '972651746b73f234031e3eae3c7b71b5d255d0ef',
        local: './test-repos/contracts-fixture/billing',
      },
      {
        id: 'repo_fixture_reports',
        uri: 'fixture://contracts/reports',
        sha: '06f27bd72248a3c8513bc58807d98de15c286b8c',
        local: './test-repos/contracts-fixture/reports',
      },
      {
        id: 'repo_fixture_platform',
        uri: 'fixture://contracts/platform',
        sha: 'efec0ee36e7b76d47d1810c14cd3574c3c75292c',
        local: './test-repos/contracts-fixture/platform',
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
