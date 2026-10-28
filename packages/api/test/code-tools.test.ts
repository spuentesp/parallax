import { describe, expect, it } from 'vitest';
import { CODE_TOOLS } from '../src/agent/code-tools.js';
import { createDispatcher } from '../src/agent/dispatcher.js';
import type { ToolCall } from '../src/agent/nemotron.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const call = (name: string, args: unknown): ToolCall => ({
  id: `c_${name}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

function spied() {
  const lain = createLainMock();
  const seen: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const spy: LainAdapter = {
    ...lain,
    async codeTool(tool, args) {
      seen.push({ tool, args });
      return { text: `## ${tool}` };
    },
  };
  return { spy, seen };
}

describe('code tools in the investigator', () => {
  it('are offered to the model next to the contract tools, read-only, without a snapshot', () => {
    const { spy } = spied();
    const names = createDispatcher({ lain: spy, view: 'live' })
      .toolSpecs()
      .map((s) => s.function.name);
    for (const t of [
      'search_code',
      'find_symbol',
      'get_blast_radius',
      'get_cross_repo_blast_radius',
    ]) {
      expect(names).toContain(t);
    }
    expect(names).toContain('consumers_of');
    // Nada que escriba, ejecute ni coordine agentes.
    for (const t of CODE_TOOLS)
      expect(t).not.toMatch(/^(run_|claim_|release_|add_|register_|install_|request_|sync_)/);
  });

  it('runs one against LAIN, translating repo to repo_id', async () => {
    const { spy, seen } = spied();
    const d = createDispatcher({ lain: spy, view: 'live' });
    const r = await d.execute(
      call('search_code', { query: 'checkout shipping address', limit: 5 }),
    );
    expect(r.ok).toBe(true);
    expect(seen[0]).toEqual({
      tool: 'search_code',
      args: { query: 'checkout shipping address', limit: 5 },
    });
  });

  it('rejects a repo outside the analysed view before touching LAIN', async () => {
    const { spy, seen } = spied();
    const d = createDispatcher({ lain: spy, view: 'live' });
    const r = await d.execute(call('find_symbol', { name: 'x', repo: 'not-in-the-view' }));
    expect(r).toMatchObject({ ok: false, code: 'scope_violation' });
    expect(seen).toHaveLength(0);
  });

  it('passes a repo of the view as repo_id', async () => {
    const { spy, seen } = spied();
    const d = createDispatcher({ lain: spy, view: 'live' });
    const known = await spy.listServices({ snapshot: 'live' } as never);
    const repo = known.items[0]?.repo ?? '';
    const r = await d.execute(call('get_blast_radius', { symbol: 'main', repo }));
    expect(r.ok).toBe(true);
    expect(seen[0]?.args).toEqual({ symbol: 'main', repo_id: repo });
  });

  it('rejects unknown arguments and unlisted tools; the tools the model cannot see stay unreachable', async () => {
    const { spy, seen } = spied();
    const d = createDispatcher({ lain: spy, view: 'live' });
    expect(await d.execute(call('search_code', { query: 'x', snapshot: 'live' }))).toMatchObject({
      ok: false,
      code: 'invalid_schema',
    });
    for (const t of ['run_tests', 'claim_files', 'sync_state']) {
      expect(await d.execute(call(t, {}))).toMatchObject({ ok: false, code: 'unknown_tool' });
    }
    expect(seen).toHaveLength(0);
  });

  it('counts against the same research budget', async () => {
    const { spy } = spied();
    const d = createDispatcher({ lain: spy, view: 'live', maxToolCalls: 1 });
    expect((await d.execute(call('list_entry_points', {}))).ok).toBe(true);
    expect(await d.execute(call('list_entry_points', {}))).toMatchObject({
      code: 'budget_exhausted',
    });
  });
});
