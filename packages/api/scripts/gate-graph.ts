// Graph gate — topología de código expandible contra el fixture contracts.
//
// Prueba la cadena repo → archivo → símbolo sobre query_graph (paquete raw),
// incluida la expansión de comunicación arista por arista y el contrato de
// describe_schema que el builder asume. Un resultado vacío se comprueba vacío:
// nunca se acepta una arista sintetizada (INV 3).
//
// Requiere un LAIN con el fixture contracts corriendo:
//   LAIN_URL=http://localhost:9997/mcp pnpm --filter @parallax/api exec tsx scripts/gate-graph.ts

import {
  buildGraphChildren,
  buildRepoRoot,
  COMM_EDGE_TYPES,
  ROOT_NODE_TYPES,
} from '../src/code-graph.js';
import { createLainClient } from '../src/lain-adapter/client.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const LAIN_URL = process.env.LAIN_URL ?? 'http://localhost:9997/mcp';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function gRaw(lain: LainAdapter): Promise<void> {
  console.log('\n=== GGRAPH.1 raw cargado y query_graph disponible ===');
  // createLainClient ya intenta load_package(raw/arch/workspace) en el boot.
  const pkg = await lain.loadPackage({ package: 'raw' });
  check(
    'load_package(raw) responde loaded o already_loaded',
    pkg.loaded === true || pkg.already_loaded === true,
    JSON.stringify({ loaded: pkg.loaded, already_loaded: pkg.already_loaded }),
  );
  const res = await lain.queryGraph({
    query: { ops: [{ op: 'find', type: 'Function', name: 'main' }] },
    repo_id: 'orders',
  });
  check('query_graph responde', res.count >= 0, `count=${res.count}`);
  check('query_graph normaliza nodes ausente a []', Array.isArray(res.nodes));
  const connected = await lain.queryGraph({
    query: {
      ops: [
        { op: 'find', type: 'File', name: 'main.rs' },
        { op: 'connect', edge: 'Contains', direction: 'outgoing', depth: 1 },
      ],
    },
    repo_id: 'orders',
  });
  check(
    'query_graph connect devuelve las aristas reales de 0.11',
    Array.isArray(connected.edges) && connected.edges.length > 0,
  );
  check(
    'query_graph connect devuelve los caminos reales de 0.11',
    Array.isArray(connected.paths) &&
      connected.paths.length === connected.nodes.length &&
      connected.nodes.length > 0,
  );
}

async function gRoot(lain: LainAdapter): Promise<void> {
  console.log('\n=== GGRAPH.2 raíz de orders: estructura de alto nivel ===');
  const root = await buildRepoRoot(lain, 'orders');
  check('sin error de consulta', root.error === undefined, root.error);
  const types = new Set(root.nodes.map((n) => n.type));
  check('múltiples tipos de nodo', types.size >= 3, [...types].join(', '));
  check('incluye File', types.has('File'));
  check('incluye HttpRoute', types.has('HttpRoute'));
  check(
    'sólo tipos de la raíz (sin volcar todos los símbolos)',
    root.nodes.every((n) => (ROOT_NODE_TYPES as readonly string[]).includes(n.type)),
    root.nodes.map((n) => `${n.type}:${n.name}`).slice(0, 6).join(', '),
  );
}

async function gFileExpansion(lain: LainAdapter): Promise<void> {
  console.log('\n=== GGRAPH.3 expandir un File devuelve sus símbolos ===');
  const res = await buildGraphChildren(lain, { repo: 'orders', type: 'File', name: 'main.rs' });
  const types = new Set(res.children.map((c) => c.type));
  check('main.rs contiene un Function', types.has('Function'), [...types].join(', '));
  check(
    'Function main entre los hijos',
    res.children.some((c) => c.type === 'Function' && c.name === 'main'),
  );

  const create = await buildGraphChildren(lain, {
    repo: 'orders',
    type: 'File',
    name: 'create.rs',
  });
  check(
    'create.rs contiene create_order',
    create.children.some((c) => c.type === 'Function' && c.name === 'create_order'),
    create.children.map((c) => `${c.type}:${c.name}`).join(', '),
  );
}

async function gComm(lain: LainAdapter): Promise<void> {
  console.log('\n=== GGRAPH.4 comunicación: vecinos reales o vacío honesto ===');
  // get_order sí tiene comunicación (Uses de Structs + rutas CallsHttp).
  const wired = await buildGraphChildren(lain, {
    repo: 'orders',
    type: 'Function',
    name: 'get_order',
  });
  check('get_order tiene vecinos de comunicación', wired.hasCommunication);
  check(
    'los vecinos vienen rotulados por arista',
    wired.communications.every((g) => COMM_EDGE_TYPES.includes(g.edge as never)),
    wired.communications.map((g) => `${g.edge}:${g.nodes.length}`).join(', '),
  );
  const uses = wired.communications.find((g) => g.edge === 'Uses');
  check('Uses de get_order incluye Struct Order', uses?.nodes.some((n) => n.name === 'Order') === true);

  // main es un callejón sin comunicación en el fixture: el builder lo debe
  // reportar como vacío, no rellenarlo.
  const leaf = await buildGraphChildren(lain, { repo: 'orders', type: 'Function', name: 'main' });
  check('main no tiene comunicación (vacío honesto)', leaf.hasCommunication === false);
  check(
    'sin grupos de arista con vecinos',
    leaf.communications.every((g) => g.nodes.length === 0),
    leaf.communications.map((g) => `${g.edge}:${g.nodes.length}`).join(', ') || 'sin grupos',
  );
}

async function gSchema(lain: LainAdapter): Promise<void> {
  console.log('\n=== GGRAPH.5 describe_schema coincide con lo que el builder asume ===');
  const schema = await lain.describeSchema({});
  const nodeNames = new Set(schema.node_types.map((t) => t.name));
  const edgeNames = new Set(schema.edge_types.map((e) => e.name));

  const assumedNodes = [
    ...ROOT_NODE_TYPES,
    'Function',
    'Method',
    'Struct',
    'Enum',
    'Trait',
    'Class',
    'Interface',
    'Schema',
  ];
  const missingNodes = assumedNodes.filter((n) => !nodeNames.has(n));
  check(
    'todos los tipos de nodo asumidos existen en el esquema',
    missingNodes.length === 0,
    missingNodes.length > 0 ? `faltan: ${missingNodes.join(', ')}` : `${nodeNames.size} tipos`,
  );

  const assumedEdges = ['Contains', ...COMM_EDGE_TYPES];
  const missingEdges = assumedEdges.filter((e) => !edgeNames.has(e));
  check(
    'Contains y las 6 aristas de comunicación existen en el esquema',
    missingEdges.length === 0,
    missingEdges.length > 0 ? `faltan: ${missingEdges.join(', ')}` : `${edgeNames.size} aristas`,
  );

  // Imports está declarado pero sin indexar: el builder lo tolera con error
  // visible, no con un vacío silencioso.
  const imports = schema.edge_types.find((e) => e.name === 'Imports');
  check('Imports aparece en el esquema', imports !== undefined, `indexed=${imports?.indexed}`);
}

async function main(): Promise<void> {
  console.log(`Graph gate contra ${LAIN_URL}`);
  const lain = await createLainClient({ lainUrl: LAIN_URL, apiVersion: '1', timeoutMs: 60_000 });
  console.log(`handshake OK (analyzerVersion=${lain.analyzerVersion})`);

  await gRaw(lain);
  await gRoot(lain);
  await gFileExpansion(lain);
  await gComm(lain);
  await gSchema(lain);

  console.log('\n=== GGRAPH RESULT ===');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`GGRAPH: FAIL (${failures} fallas)`);
    process.exitCode = 1;
  } else {
    console.log('GGRAPH: PASS');
  }
}

main().catch((e) => {
  console.error('GGRAPH gate error:', e);
  process.exitCode = 1;
});
