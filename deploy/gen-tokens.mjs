#!/usr/bin/env node
// Genera los tokens de la demo: uno de administración (lectura+escritura) y uno
// de revisión (sólo lectura) para los jueces, y el enlace que los firma dentro.
//
//   node deploy/gen-tokens.mjs https://parallax.example.com [workspaceId]
//
// Imprime la línea PARALLAX_TOKENS para deploy/.env y el enlace de los jueces.
import { randomBytes } from 'node:crypto';

const base = (process.argv[2] ?? 'https://<demo-host>').replace(/\/+$/, '');
const workspace = process.argv[3] ?? 'ws_saleor';
const make = () => `px_${randomBytes(24).toString('base64url')}`;

const admin = make();
const judge = make();
const tokens = [
  { token: admin, orgId: 'demo', scopes: ['read', 'write'] },
  { token: judge, orgId: 'demo', scopes: ['read'] },
];

console.log('# deploy/.env');
console.log(`PARALLAX_TOKENS='${JSON.stringify(tokens)}'`);
console.log('');
console.log('# Admin (you): paste on the access screen, or');
console.log(`${base}/orgs/${workspace}?token=${admin}`);
console.log('');
console.log('# Judges (read-only) — put THIS link in the Devpost testing instructions:');
console.log(`${base}/orgs/${workspace}?token=${judge}`);
