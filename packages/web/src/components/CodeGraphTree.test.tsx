import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeGraphTree } from './CodeGraphTree.js';
import type {
  CodeGraphChildrenResponse,
  GraphRootResponse,
  GraphSnippetResponse,
} from '../api/hooks.js';

afterEach(() => cleanup());

const rootData: GraphRootResponse = {
  graph: {
    repos: [
      {
        repo: 'orders',
        nodes: [
          { id: '1', name: 'main.rs', type: 'File', kind: 'container' },
          { id: '2', name: 'POST /api/orders', type: 'HttpRoute', kind: 'route' },
        ],
        truncated: false,
      },
    ],
  },
  source: 'lain',
};

const fileChildren: CodeGraphChildrenResponse = {
  node: { repo: 'orders', type: 'File', name: 'main.rs' },
  children: [{ id: '3', name: 'main', type: 'Function', kind: 'symbol' }],
  childrenTruncated: false,
  communications: [],
  hasCommunication: false,
  source: 'lain',
};

const fnChildren: CodeGraphChildrenResponse = {
  node: { repo: 'orders', type: 'Function', name: 'main' },
  children: [],
  childrenTruncated: false,
  communications: [
    {
      edge: 'CallsHttp',
      nodes: [{ id: '2', name: 'POST /api/orders', type: 'HttpRoute', kind: 'route' }],
    },
  ],
  hasCommunication: true,
  source: 'lain',
};

const snippet: GraphSnippetResponse = {
  snippet: {
    symbol: 'main',
    repo: 'orders',
    path: 'src/main.rs',
    text: 'File: src/main.rs\n   1: fn main() {}',
  },
  source: 'lain',
};

type FetchChildren = (ref: {
  repo: string;
  type: string;
  name: string;
}) => Promise<CodeGraphChildrenResponse>;

type FetchSnippet = (repo: string, symbol: string) => Promise<GraphSnippetResponse>;

function mkFetchSnippet(): FetchSnippet & ReturnType<typeof vi.fn> {
  return vi.fn<FetchSnippet>(async () => snippet);
}

function mkFetchChildren(): FetchChildren & ReturnType<typeof vi.fn> {
  return vi.fn<FetchChildren>(async (ref) => {
    if (ref.type === 'File') return fileChildren;
    return fnChildren;
  });
}

describe('CodeGraphTree', () => {
  it('renders repos and their root nodes with type badges', () => {
    render(
      <CodeGraphTree
        data={rootData}
        fetchChildren={mkFetchChildren()}
        fetchSnippet={mkFetchSnippet()}
      />,
    );
    const tree = screen.getByTestId('code-graph-tree');
    expect(tree.textContent).toContain('orders');
    expect(tree.textContent).toContain('main.rs');
    expect(tree.textContent).toContain('File');
    expect(tree.textContent).toContain('POST /api/orders');
    expect(tree.textContent).toContain('HttpRoute');
  });

  it('fetches children on demand and nests them under the node', async () => {
    const fetchChildren = mkFetchChildren();
    render(
      <CodeGraphTree data={rootData} fetchChildren={fetchChildren} fetchSnippet={mkFetchSnippet()} />,
    );
    expect(fetchChildren).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('graph-node-orders|File|main.rs'));
    await waitFor(() => expect(fetchChildren).toHaveBeenCalledTimes(1));
    expect(fetchChildren).toHaveBeenCalledWith({ repo: 'orders', type: 'File', name: 'main.rs' });
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    // Un File sin comunicación lo dice, no se rellena.
    expect(screen.getByText(/no communication edges/i)).toBeTruthy();
  });

  it('shows communication neighbours labelled with the edge type', async () => {
    render(
      <CodeGraphTree
        data={rootData}
        fetchChildren={mkFetchChildren()}
        fetchSnippet={mkFetchSnippet()}
      />,
    );
    fireEvent.click(screen.getByTestId('graph-node-orders|File|main.rs'));
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    fireEvent.click(screen.getByTestId('graph-node-orders|Function|main'));
    await waitFor(() => expect(screen.getByText('CallsHttp')).toBeTruthy());
    expect(screen.getAllByText('POST /api/orders').length).toBeGreaterThan(0);
  });

  it('says "no children" for a node without contained symbols', async () => {
    const noChildren: CodeGraphChildrenResponse = {
      node: { repo: 'orders', type: 'HttpRoute', name: 'POST /api/orders' },
      children: [],
      childrenTruncated: false,
      communications: [],
      hasCommunication: false,
      source: 'lain',
    };
    render(
      <CodeGraphTree
        data={rootData}
        fetchChildren={async () => noChildren}
        fetchSnippet={mkFetchSnippet()}
      />,
    );
    fireEvent.click(screen.getByTestId('graph-node-orders|HttpRoute|POST /api/orders'));
    await waitFor(() => expect(screen.getByText(/no children/i)).toBeTruthy());
    expect(screen.getByText(/no communication edges/i)).toBeTruthy();
  });

  it('opens a snippet for a leaf symbol via the source action', async () => {
    const fetchSnippet = mkFetchSnippet();
    render(
      <CodeGraphTree
        data={rootData}
        fetchChildren={mkFetchChildren()}
        fetchSnippet={fetchSnippet}
      />,
    );
    fireEvent.click(screen.getByTestId('graph-node-orders|File|main.rs'));
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    const sourceButtons = screen.getAllByText('source');
    fireEvent.click(sourceButtons[0] as HTMLElement);
    await waitFor(() => expect(fetchSnippet).toHaveBeenCalledWith('orders', 'main'));
    await waitFor(() => expect(screen.getByTestId('snippet-panel').textContent).toContain('fn main'));
  });

  it('surfaces an expansion error instead of silently collapsing', async () => {
    render(
      <CodeGraphTree
        data={rootData}
        fetchChildren={async () => {
          throw new Error('Config error: repo not found');
        }}
        fetchSnippet={mkFetchSnippet()}
      />,
    );
    fireEvent.click(screen.getByTestId('graph-node-orders|File|main.rs'));
    await waitFor(() =>
      expect(screen.getByText(/expansion failed/i)).toBeTruthy(),
    );
  });

  it('shows the unconfigured state when the workspace has no LAIN', () => {
    render(
      <CodeGraphTree
        data={{ graph: { repos: [] }, source: 'unconfigured' }}
        fetchChildren={mkFetchChildren()}
        fetchSnippet={mkFetchSnippet()}
      />,
    );
    expect(screen.getByText(/no LAIN server configured/i)).toBeTruthy();
  });
});
