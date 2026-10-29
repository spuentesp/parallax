#!/usr/bin/env node
// Generates demo access tokens:
// 1. "Looking" token: read-only access (for viewers to explore architecture, traces, and code without modifying state)
// 2. "Judges" token: interactive testing access (for judges to test AI queries, PR evaluations, and simulations)
//
// Usage:
//   node deploy/gen-tokens.mjs https://YOUR.DOMAIN [workspaceId]
import { randomBytes } from 'node:crypto';

const base = (process.argv[2] ?? 'https://<demo-host>').replace(/\/+$/, '');
const workspace = process.argv[3] ?? 'ws_saleor';
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
console.log('--- DIRECT ACCESS LINKS ---');
console.log('# 1. Just for Looking (Read-only viewer access):');
console.log(`${base}/orgs/${workspace}?token=${look}`);
console.log('');
console.log('# 2. For Judges to Test (Full evaluation & query testing):');
console.log(`${base}/orgs/${workspace}?token=${judge}`);
console.log('');
console.log('# 3. Maintainer / Admin (Private):');
console.log(`${base}/orgs/${workspace}?token=${admin}`);
