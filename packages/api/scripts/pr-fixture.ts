// Fixture autocontenida para evaluar PRs: dos repos git con historia real
// (provider `orders` con dos commits, consumidor `billing` con uno) y un LAIN
// arrancado sobre ellos. El diff entre los dos commits de `orders` es conocido:
//
//   GET  /orders/{order_id}        eliminado, consumido por billing  (rompe)
//   GET  /orders/{order_id}/audit  eliminado, sin consumidor propio
//   POST /orders/bulk              añadido
//   GET  /orders                   sin cambio de contrato
//
// La verdad de referencia es lo que el motor reporta sobre ese diff (se lee de
// engine_json); este fixture sólo fija los commits.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLainClient } from '../src/lain-adapter/client.js';
import { waitForIndexedRepos } from './lain-readiness.js';

const ORDERS_BASE = `from fastapi import FastAPI

app = FastAPI()


@app.get("/orders")
def list_orders():
    return []


@app.get("/orders/{order_id}")
def get_order(order_id: str):
    return {"id": order_id}


@app.get("/orders/{order_id}/audit")
def get_order_audit(order_id: str):
    return []
`;

const ORDERS_HEAD = `from fastapi import FastAPI

app = FastAPI()


@app.get("/orders")
def list_orders():
    return []


@app.post("/orders/bulk")
def bulk_create(payload: dict):
    return {"created": 0}
`;

const BILLING = `import os

import httpx


def fetch_order(order_id: str):
    return httpx.get(f"{os.environ['ORDERS_URL']}/orders/{order_id}")


def fetch_orders():
    return httpx.get(f"{os.environ['ORDERS_URL']}/orders")
`;

export interface PrFixture {
  root: string;
  lainUrl: string;
  orders: { path: string; base: string; head: string };
  billing: { path: string; sha: string };
  stop(): Promise<void>;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=PR fixture', '-c', 'user.email=fixture@localhost', ...args],
    { encoding: 'utf8' },
  ).trim();
}

function commit(repo: string, file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', message);
  return git(repo, 'rev-parse', 'HEAD');
}

export async function startPrFixture(
  port = Number(process.env.PR_FIXTURE_PORT ?? 9996),
): Promise<PrFixture> {
  const root = mkdtempSync(join(tmpdir(), 'parallax-pr-fixture-'));
  const orders = join(root, 'orders');
  const billing = join(root, 'billing');
  mkdirSync(orders);
  mkdirSync(billing);
  git(orders, 'init', '-q');
  git(billing, 'init', '-q');
  const base = commit(orders, 'main.py', ORDERS_BASE, 'base');
  const head = commit(orders, 'main.py', ORDERS_HEAD, 'head');
  const billingSha = commit(billing, 'client.py', BILLING, 'base');

  writeFileSync(
    join(root, 'repos.yaml'),
    [
      `data_dir: ${join(root, '.lain')}`,
      'repos:',
      '  - id: orders',
      `    source: { type: workspace_dir, path: ${orders} }`,
      '  - id: billing',
      `    source: { type: workspace_dir, path: ${billing} }`,
      'services:',
      '  - name: orders',
      '    repo: orders',
      '    env: [ORDERS_URL]',
      '  - name: billing',
      '    repo: billing',
      '',
    ].join('\n'),
  );

  const child: ChildProcess = spawn(
    process.env.LAIN_BIN ?? 'lain',
    ['server', '--config', join(root, 'repos.yaml'), '--transport', 'http', '--port', String(port)],
    // Propio grupo de procesos: `lain` puede ser un shim (npm) que arranca el
    // binario real; matar sólo al shim dejaría el servidor vivo sobre un
    // directorio ya borrado y el siguiente arranque lo reutilizaría.
    { stdio: 'ignore', detached: true },
  );
  const stop = async (): Promise<void> => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
    rmSync(root, { recursive: true, force: true });
  };

  try {
    const lainUrl = `http://localhost:${port}/mcp`;
    let lain: Awaited<ReturnType<typeof createLainClient>> | undefined;
    for (let i = 0; i < 300 && !lain; i++) {
      try {
        lain = await createLainClient({ lainUrl, apiVersion: '1', maxRetries: 0 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!lain) throw new Error(`lain did not start on port ${port}`);
    await waitForIndexedRepos(lain, ['orders', 'billing'], 60_000);
    return {
      root,
      lainUrl,
      orders: { path: orders, base, head },
      billing: { path: billing, sha: billingSha },
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
