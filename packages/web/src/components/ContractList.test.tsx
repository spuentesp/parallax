import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LooseEndDto, TopologyEdge, TopologyNode } from '../api/hooks.js';
import { renderWithQuery } from '../test/render.js';
import {
  buildContractRows,
  ContractList,
  type ContractRow,
  consumerAnnotation,
} from './ContractList.js';

afterEach(cleanup);

const n = (
  id: string,
  kind: TopologyNode['kind'],
  parent: string | null,
  label = id,
): TopologyNode => ({
  id,
  label,
  kind,
  parent,
  meta: {},
});
const consumes = (
  source: string,
  target: string,
  meta: Record<string, unknown> = { binding: 'static', staticUses: 1 },
): TopologyEdge => ({ source, target, kind: 'consumes', meta });
const loose = (candidates: string[]): LooseEndDto => ({
  key: candidates.join('|'),
  group: 'g',
  kind: 'unresolved',
  repo: 'dashboard',
  path: 'src/dynamic.ts',
  line: 44,
  reason: 'no_match',
  detail: {},
  candidates,
  candidateCount: candidates.length,
  assessment: null,
});

const NODES: TopologyNode[] = [
  n('repo:saleor', 'repo', null, 'saleor/saleor'),
  n('svc:core', 'service', 'repo:saleor', 'saleor-core'),
  n('svc:dash', 'service', 'repo:saleor', 'dashboard'),
  n('ep:graphql:query:checkout@saleor-core', 'endpoint', 'svc:core', 'graphql:query:checkout'),
  n(
    'ep:graphql:mutation:checkoutComplete@saleor-core',
    'endpoint',
    'svc:core',
    'graphql:mutation:checkoutComplete',
  ),
  n('ep:table:checkout_checkout@saleor-core', 'endpoint', 'svc:core', 'table checkout_checkout'),
];
const EDGES: TopologyEdge[] = [
  consumes('svc:dash', 'ep:graphql:query:checkout@saleor-core'),
  consumes('svc:dash', 'ep:graphql:query:checkout@saleor-core', {
    binding: 'heuristic',
    heuristicUses: 1,
  }),
  consumes('svc:dash', 'ep:graphql:mutation:checkoutComplete@saleor-core', {
    binding: 'heuristic',
    heuristicUses: 2,
  }),
];

describe('buildContractRows / consumerAnnotation', () => {
  const rows = buildContractRows(NODES, EDGES, [loose(['graphql:query:checkout'])]);

  const rowOf = (label: string): ContractRow => {
    const r = rows.find((x) => x.label === label);
    if (!r) throw new Error(`row not found: ${label}`);
    return r;
  };

  it('annotates proven consumers, inferred consumers and could-match separately', () => {
    const checkout = rowOf('graphql:query:checkout');
    expect(checkout.consumers).toBe(1);
    expect(checkout.inferred).toBe(1);
    expect(checkout.couldMatch).toBe(1);
    expect(consumerAnnotation(checkout)).toBe('1 consumer · 1 inferred · +1 could match');
  });

  it('a purely inferred consumer is annotated as inferred', () => {
    const mutation = rowOf('graphql:mutation:checkoutComplete');
    expect(mutation.inferred).toBe(1);
    expect(consumerAnnotation(mutation)).toBe('1 inferred');
  });

  it('a contract nobody consumes (within scope) is "internal only"', () => {
    const table = rowOf('table checkout_checkout');
    expect(table.internalOnly).toBe(true);
    expect(consumerAnnotation(table)).toBe('internal only');
  });

  it('rows carry provider service and repo, sorted by usage first', () => {
    expect(rows[0]?.label).toBe('graphql:query:checkout');
    expect(rows[0]?.provider).toBe('saleor-core');
    expect(rows[0]?.repo).toBe('saleor/saleor');
  });
});

describe('ContractList component', () => {
  it('renders rows with kind chip, provider and annotation badge; filters by kind and query', async () => {
    renderWithQuery(
      <ContractList nodes={NODES} edges={EDGES} looseEnds={[loose(['graphql:query:checkout'])]} />,
    );
    const list = await screen.findByTestId('contract-list');
    expect(within(list).getByText('graphql:query:checkout')).toBeTruthy();
    expect(within(list).getAllByText(/1 consumer/).length).toBeGreaterThan(0);
    expect(within(list).getAllByText(/\+1 could match/).length).toBeGreaterThan(0);
    expect(within(list).getByText('internal only')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search contracts'), {
      target: { value: 'checkoutComplete' },
    });
    expect(within(list).queryByText('graphql:query:checkout')).toBeNull();
    expect(within(list).getByText('graphql:mutation:checkoutComplete')).toBeTruthy();
  });

  it('applies the contract-kind filter from the page filter bar', async () => {
    renderWithQuery(
      <ContractList nodes={NODES} edges={EDGES} looseEnds={[]} kindFilter="graphql" />,
    );
    const list = await screen.findByTestId('contract-list');
    expect(within(list).queryByText('table checkout_checkout')).toBeNull();
    expect(within(list).getByText('graphql:query:checkout')).toBeTruthy();
  });
});
