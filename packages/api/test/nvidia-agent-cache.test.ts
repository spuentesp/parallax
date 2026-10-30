import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, 'fixtures/nvidia-agent-cache.json');

describe('NVIDIA Agent Real Execution Cache', () => {
  it('loads real Nemotron responses captured from live NVIDIA LAIN workspace', () => {
    expect(fs.existsSync(CACHE_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

    // 1. Deep call stack test case
    expect(data.deep_call_stack).toBeDefined();
    const deep = data.deep_call_stack;
    expect(deep.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(deep.explanationStatus).toBe('available');
    expect(deep.answer).toMatch(/ORM table.*persistence.*RPC.*client/i);
    expect(deep.budget.toolCallsUsed).toBeGreaterThanOrEqual(1);
    expect(deep.budget.modelMsUsed).toBeLessThanOrEqual(120_000);
    expect(deep.claims.length).toBeGreaterThanOrEqual(1);

    // 2. OpenShell consumers test case
    expect(data.openshell_consumers).toBeDefined();
    const openshell = data.openshell_consumers;
    expect(openshell.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(openshell.answer).toMatch(/openshell-sdk.*openshell/i);
    expect(openshell.claimsSummary.verified).toBeGreaterThanOrEqual(1);

    // 3. NeMo Agent Toolkit test case
    expect(data.nat_runtime).toBeDefined();
    const nat = data.nat_runtime;
    expect(nat.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(nat.answer).toMatch(/nat.*HTTP.*WebSocket/i);
  });
});
