// Una afirmación "esto vive en repo:ruta:línea" la adjudica el motor leyendo esas
// líneas. Se prueban los desenlaces reales de get_code_snippet (texto "Error:
// Not found…", "Config error…") con un motor falso en el borde.

import { describe, expect, it } from 'vitest';
import { Claim, SubmitAnswerArgs, verifyClaims } from '../src/agent/claims.js';
import { createLainMock } from '../src/lain-adapter/mock.js';
import type { LainAdapter } from '../src/lain-adapter/types.js';

const FILE = [
  '437:     return updated_fields',
  '438: ',
  '440: def change_shipping_address_in_checkout(',
  '441:     checkout_info: "CheckoutInfo",',
].join('\n');

function engine(reply: (a: { path: string; repo_id?: string; line?: number }) => string | Error) {
  const calls: unknown[] = [];
  const lain = {
    ...createLainMock(),
    getCodeSnippet: async (a: { path: string; repo_id?: string; line?: number }) => {
      calls.push(a);
      const r = reply(a);
      if (r instanceof Error) throw r;
      return { text: r };
    },
  } as unknown as LainAdapter;
  return { lain, calls };
}

const deps = (lain: LainAdapter, repos = ['saleor']) => ({
  lain,
  view: 'live',
  resolveService: async () => null,
  validateRefs: async () => ({ accepted: [], receipts: [], rejected: [] }),
  hasRepo: async (n: string) => repos.includes(n),
});
const loc = (over: object = {}) =>
  Claim.parse({
    kind: 'location',
    repo: 'saleor',
    path: 'saleor/checkout/utils.py',
    line: 440,
    contains: 'change_shipping_address_in_checkout',
    text: 'sets the shipping address',
    ...over,
  });

describe('location claims', () => {
  it('VERIFIED when the engine reads the lines and the text is there', async () => {
    const { lain, calls } = engine(() => `File: x\nShowing lines 437-468\n\n${FILE}`);
    const [r] = await verifyClaims([loc()], deps(lain));
    expect(r?.verdict).toBe('verified');
    expect(r?.reason).toMatch(/saleor:saleor\/checkout\/utils\.py:440.*is there/);
    expect(calls[0]).toMatchObject({
      repo_id: 'saleor',
      path: 'saleor/checkout/utils.py',
      line: 440,
    });
  });

  it('the text match ignores case but not substance', async () => {
    const { lain } = engine(() => FILE);
    expect(
      (await verifyClaims([loc({ contains: 'CHANGE_SHIPPING_ADDRESS' })], deps(lain)))[0]?.verdict,
    ).toBe('verified');
    expect(
      (await verifyClaims([loc({ contains: 'billing_address' })], deps(lain)))[0]?.verdict,
    ).toBe('contradicted');
  });

  it('CONTRADICTED when the file or the line does not exist', async () => {
    for (const msg of [
      'Error: Not found: line 8997 is past the end of /x/utils.py (1102 lines)',
      'Error: Not found: Path not found: /x/missing.py (No such file or directory (os error 2))',
    ]) {
      const { lain } = engine(() => msg);
      const [r] = await verifyClaims([loc()], deps(lain));
      expect(r?.verdict, msg).toBe('contradicted');
      expect(r?.reason).toMatch(/does not exist in the index/);
    }
  });

  it('UNVERIFIABLE when the engine cannot read it (unknown repo, engine failure), never a guess', async () => {
    const a = engine(() => "Config error: unknown repo_id 'nothere'; registered: saleor");
    expect((await verifyClaims([loc({ repo: 'saleor' })], deps(a.lain)))[0]?.verdict).toBe(
      'unverifiable',
    );
    const b = engine(() => new Error('lain unreachable'));
    const r = (await verifyClaims([loc()], deps(b.lain)))[0];
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toMatch(/lain unreachable/);
  });

  it('a repo outside the analysed view is not read at all', async () => {
    const { lain, calls } = engine(() => FILE);
    const [r] = await verifyClaims([loc({ repo: 'other' })], deps(lain));
    expect(r?.verdict).toBe('unverifiable');
    expect(r?.reason).toMatch(/not in the analyzed view/);
    expect(calls).toHaveLength(0);
  });

  it('the schema demands what makes it checkable: a line and the text that must be there', () => {
    const base = { kind: 'location', repo: 'r', path: 'p', text: 't' };
    expect(Claim.safeParse({ ...base, line: 1 }).success).toBe(false); // sin contains
    expect(Claim.safeParse({ ...base, contains: 'x' }).success).toBe(false); // sin línea
    expect(Claim.safeParse({ ...base, line: 0, contains: 'x' }).success).toBe(false);
    expect(Claim.safeParse({ ...base, line: 3, contains: 'x', extra: 1 }).success).toBe(false);
    expect(SubmitAnswerArgs.safeParse({ answer: 'a', claims: [loc()] }).success).toBe(true);
  });

  it('mixed claims keep their own verdicts', async () => {
    const { lain } = engine(() => FILE);
    const rs = await verifyClaims([loc(), loc({ contains: 'nope' })], deps(lain));
    expect(rs.map((r) => r.verdict)).toEqual(['verified', 'contradicted']);
  });
});

import { extractFileLines } from '../src/agent/claims.js';
import { type ChatCompleter, investigate } from '../src/agent/investigator.js';
import type { ChatMessage, NemotronResponse, ToolCall } from '../src/agent/nemotron.js';

describe('extractFileLines', () => {
  it('finds path:line statements and ignores things that merely look like them', () => {
    const text =
      'It is set in `saleor/checkout/utils.py:440` and used at src/graphql/authFetch.ts:138 (also saleor/checkout/utils.py:440). ' +
      'Time 12:30, port localhost:8099, version 0.13.0:5, key a:1 and http://x/y.js:3000 are not locations.';
    expect(extractFileLines(text)).toEqual([
      'saleor/checkout/utils.py:440',
      'src/graphql/authFetch.ts:138',
    ]);
  });
  it('needs a directory and a known extension', () => {
    expect(extractFileLines('main.py:3 and README.md:10')).toEqual([]);
  });
});

const tc = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const resp = (toolCalls: ToolCall[]): NemotronResponse => ({
  content: null,
  toolCalls,
  finishReason: 'tool_calls',
  usage: { promptTokens: 1, completionTokens: 1 },
  model: 'f',
  latencyMs: 1,
});

describe('investigate — file:line statements must come with location claims', () => {
  async function run(
    second: unknown,
    answer = 'The address is set at saleor/checkout/utils.py:440.',
  ) {
    const script = [
      resp([tc('a', 'list_services', {})]),
      resp([tc('b', 'submit_answer', { answer, claims: [] })]),
      resp([tc('c', 'submit_answer', second)]),
    ];
    const seen: ChatMessage[][] = [];
    const model: ChatCompleter = {
      complete: async (m) => {
        seen.push(structuredClone(m));
        return script.shift() as NemotronResponse;
      },
    };
    const { lain } = engine(() => FILE);
    const result = await investigate({
      question: 'where?',
      lain,
      model,
      view: 'live',
      budget: { maxToolCalls: 8, maxModelMs: 30_000 },
    });
    return { result, seen };
  }

  it('sends the answer back once, naming the locations, and verifies the claims it then gets', async () => {
    const { result, seen } = await run({
      answer: 'The address is set at saleor/checkout/utils.py:440.',
      claims: [
        {
          kind: 'location',
          repo: 'orders',
          path: 'saleor/checkout/utils.py',
          line: 440,
          contains: 'change_shipping_address_in_checkout',
          text: 'sets it',
        },
      ],
    });
    const pushback =
      seen
        .at(-1)
        ?.filter((m) => m.role === 'tool')
        .map((m) => m.content ?? '')
        .join('\n') ?? '';
    expect(pushback).toMatch(/location_claims_missing/);
    expect(pushback).toMatch(/saleor\/checkout\/utils\.py:440/);
    expect(result.claims.map((c) => [c.claim.kind, c.verdict])).toEqual([['location', 'verified']]);
    expect(result.explanationStatus).toBe('available');
  });

  it('only once: a second answer without location claims is accepted as it is (no loop)', async () => {
    const { result } = await run({
      answer: 'The address is set at saleor/checkout/utils.py:440.',
      claims: [],
    });
    expect(result.answer).toMatch(/utils\.py:440/);
    expect(result.claims).toEqual([]);
  });

  it('an answer that states no file:line is not sent back', async () => {
    const { seen } = await run({ answer: 'x', claims: [] }, 'No code locations here.');
    expect(seen).toHaveLength(2); // list_services y la entrega: sin segunda ronda
  });
});
