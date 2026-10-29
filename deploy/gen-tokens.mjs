#!/usr/bin/env node
// Generates demo access tokens:
// 1. "Looking" token: read-only access (for viewers to explore architecture, traces, and code without modifying state)
// 2. "Judges" token: interactive testing access (for judges to test AI queries, PR evaluations, and simulations)
//
// Usage:
//   node deploy/gen-tokens.mjs https://YOUR.DOMAIN
import { randomBytes } from 'node:crypto';

const base = (process.argv[2] ?? 'https://<demo-host>').replace(/\/+$/, '');
const make = (prefix) => `px_${prefix}_${randomBytes(18).toString('base64url')}`;

const look = make('look');
const judge = make('judge');
const admin = make('admin');

const tokens = [
  { token: look, orgId: 'demo', scopes: ['read'] },
  { token: judge, orgId: 'demo', scopes: ['read', 'write'] },
  { token: admin, orgId: 'demo', scopes: ['read', 'write', 'publish'] },
];

console.log('# Paste into deploy/.env:');
console.log(`PARALLAX_TOKENS='${JSON.stringify(tokens)}'`);
console.log('');
console.log('--- CLUSTER A (OpenShell gRPC Surface & NeMo-Fabric) ---');
console.log('# Looking (Read-only):');
console.log(`${base}/orgs/ws_cluster_a?token=${look}`);
console.log('# Judges (Testing):');
console.log(`${base}/orgs/ws_cluster_a?token=${judge}`);
console.log('');
console.log('--- CLUSTER B (NeMo Agent Toolkit HTTP & WebSocket) ---');
console.log('# Looking (Read-only):');
console.log(`${base}/orgs/ws_cluster_b?token=${look}`);
console.log('# Judges (Testing):');
console.log(`${base}/orgs/ws_cluster_b?token=${judge}`);
console.log('');
console.log('# Maintainer / Admin (Private):');
console.log(`${base}/orgs/ws_cluster_a?token=${admin}`);
