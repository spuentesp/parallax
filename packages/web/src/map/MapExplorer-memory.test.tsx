// El mapa recuerda, por workspace, lo que el usuario dejó abierto: salir a otra
// sección y volver no lo reinicia.

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { readExpanded, writeExpanded } from '../nav/mapState.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { MapExplorer } from './MapExplorer.js';

afterEach(cleanup);

type Posted = { expand?: string[] };

function serve(): Posted[] {
  const posts: Posted[] = [];
  const node = (id: string, over: object = {}) => ({
    id,
    label: id,
    kind: 'repo',
    parent: null,
    meta: {},
    childCount: 1,
    expanded: false,
    ...over,
  });
  server.use(
    http.post('/api/workspaces/:id/map/view', async ({ request }) => {
      const body = (await request.json()) as Posted;
      posts.push(body);
      const open = new Set(body.expand ?? []);
      return HttpResponse.json({
        nodes: [
          node('repo:a', { expanded: open.has('repo:a') }),
          node('repo:b', { expanded: open.has('repo:b') }),
          ...(open.has('repo:a')
            ? [node('svc:a', { kind: 'service', parent: 'repo:a', childCount: 0 })]
            : []),
          ...(open.has('repo:b')
            ? [node('svc:b', { kind: 'service', parent: 'repo:b', childCount: 0 })]
            : []),
        ],
        edges: [],
        hiddenChildren: {},
        focus: null,
        unknownExpand: [],
        meta: { source: 'lain', generatedAt: Date.now() },
      });
    }),
  );
  return posts;
}

const mount = () =>
  renderWithQuery(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MapExplorer workspaceId="ws1" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('the map remembers what was open', () => {
  it('the first visit opens the repos and stores that; a later visit restores it without opening more', async () => {
    const posts = serve();
    const first = mount();
    const outline = within(await screen.findByTestId('map-outline'));
    expect(await outline.findByText('svc:a')).toBeTruthy();
    await waitFor(() => expect(readExpanded('ws1')).toEqual(['repo:a', 'repo:b']));
    first.unmount();

    // El usuario cerró uno antes de irse: al volver sigue cerrado.
    writeExpanded('ws1', ['repo:b']);
    posts.length = 0;
    mount();
    const again = within(await screen.findByTestId('map-outline'));
    expect(await again.findByText('svc:b')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 150));
    expect(again.queryByText('svc:a')).toBeNull();
    expect(posts.at(-1)?.expand).toEqual(['repo:b']);
  });

  it('closing everything is remembered as closing everything (the repos are not reopened for you)', async () => {
    serve();
    writeExpanded('ws1', []);
    mount();
    const outline = within(await screen.findByTestId('map-outline'));
    await outline.findByText('repo:a');
    await new Promise((r) => setTimeout(r, 150));
    expect(outline.queryByText('svc:a')).toBeNull();
    expect(readExpanded('ws1')).toEqual([]);
  });

  it('another workspace has its own memory', async () => {
    serve();
    writeExpanded('other', ['repo:a']);
    mount();
    const outline = within(await screen.findByTestId('map-outline'));
    expect(await outline.findByText('svc:b')).toBeTruthy(); // abrió los dos: no heredó el de "other"
    fireEvent.click(outline.getByRole('button', { name: 'Collapse repo:a' }));
    await waitFor(() => expect(readExpanded('ws1')).toEqual(['repo:b']));
    expect(readExpanded('other')).toEqual(['repo:a']);
  });
});
