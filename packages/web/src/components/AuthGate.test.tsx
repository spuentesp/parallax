import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type * as React from 'react';
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { clearToken, readToken } from '../api/token.js';
import { routes } from '../router.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { AppShell } from './AppShell.js';
import { AuthGate, TokenScreen } from './AuthGate.js';

afterEach(() => {
  cleanup();
  clearToken();
  window.history.replaceState(null, '', '/');
});

// Un API que sólo acepta un token concreto, y apunta con qué cabecera le llegó.
function serveAuth(valid: string, scopes = ['read', 'write']) {
  const seen: Array<string | null> = [];
  server.use(
    http.get('/api/whoami', ({ request }) => {
      const h = request.headers.get('authorization');
      seen.push(h);
      if (h !== `Bearer ${valid}`)
        return HttpResponse.json({ title: 'Unauthorized' }, { status: 401 });
      return HttpResponse.json({ orgId: 'acme', scopes, readOnly: !scopes.includes('write') });
    }),
  );
  return seen;
}
const gate = (url = '/') =>
  renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <AuthGate>
        <p>inside</p>
        <Where />
      </AuthGate>
    </MemoryRouter>,
    { signedIn: false },
  );
// Muestra la ruta del router: el token tiene que desaparecer DE AHÍ, no sólo de window.
function Where(): React.ReactElement {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

describe('AuthGate', () => {
  it('shows a checking state, then asks for a token when there is none (without scolding)', async () => {
    serveAuth('good');
    gate();
    expect(screen.getByText('Checking access…')).toBeTruthy();
    expect(await screen.findByLabelText('Access token')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('a wrong token is saved, rejected and called out; a right one lets you in', async () => {
    const seen = serveAuth('good');
    gate();
    const box = await screen.findByLabelText('Access token');
    fireEvent.change(box, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not accepted/);
    expect(seen.at(-1)).toBe('Bearer bad');
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('inside')).toBeTruthy();
    expect(readToken()).toBe('good');
    expect(seen.at(-1)).toBe('Bearer good');
  });

  it('a link with ?token= signs in directly and the token leaves the address bar', async () => {
    const seen = serveAuth('linked');
    gate('/orgs/acme?token=linked&sel=svc%3Aa');
    expect(await screen.findByText('inside')).toBeTruthy();
    expect(seen[0]).toBe('Bearer linked');
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/orgs/acme?sel=svc%3Aa'),
    );
  });

  it('an API that is down is not a bad token: it offers a retry', async () => {
    let up = false;
    server.use(
      http.get('/api/whoami', () =>
        up
          ? HttpResponse.json({ orgId: 'a', scopes: ['read'], readOnly: true })
          : HttpResponse.json({}, { status: 500 }),
      ),
    );
    gate();
    expect(await screen.findByText('Could not reach the Parallax API.')).toBeTruthy();
    expect(screen.queryByLabelText('Access token')).toBeNull();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('inside')).toBeTruthy();
  });

  it('Continue stays disabled until there is something to submit, and Enter submits', async () => {
    serveAuth('good');
    gate();
    const box = (await screen.findByLabelText('Access token')) as HTMLInputElement;
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(box, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(box, { target: { value: 'good' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(await screen.findByText('inside')).toBeTruthy();
  });
});

describe('AuthGate and the address bar', () => {
  it('a later navigation never puts the token back (the router, not window, owns the URL)', async () => {
    serveAuth('linked');
    function Nav(): React.ReactElement {
      const [, set] = useSearchParams();
      return (
        <button
          type="button"
          onClick={() =>
            set((p) => new URLSearchParams({ ...Object.fromEntries(p), focus: 'svc:a' }), {
              replace: true,
            })
          }
        >
          focus
        </button>
      );
    }
    renderWithQuery(
      <MemoryRouter initialEntries={['/orgs/acme?token=linked']}>
        <AuthGate>
          <Nav />
          <Where />
        </AuthGate>
      </MemoryRouter>,
      { signedIn: false },
    );
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/orgs/acme'));
    fireEvent.click(screen.getByRole('button', { name: 'focus' }));
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/orgs/acme?focus=svc%3Aa'),
    );
    expect(readToken()).toBe('linked');
  });

  it('a link to the site root keeps the token through the redirect to /orgs', async () => {
    serveAuth('rootlink');
    const router = createMemoryRouter(routes, { initialEntries: ['/?token=rootlink'] });
    renderWithQuery(<RouterProvider router={router} />, { signedIn: false });
    await waitFor(() => expect(readToken()).toBe('rootlink'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs'));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});

describe('TokenScreen', () => {
  it('hides the token as it is typed and points reviewers to the demo link', () => {
    render(<TokenScreen onSubmit={() => {}} />);
    expect((screen.getByLabelText('Access token') as HTMLInputElement).type).toBe('password');
    expect(screen.getByText(/read-only token/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('submits the typed value', () => {
    let got = '';
    render(<TokenScreen onSubmit={(t) => (got = t)} />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(got).toBe('abc');
  });
});

describe('session controls in the shell', () => {
  const shell = (signedIn: boolean | { readOnly: boolean }) =>
    renderWithQuery(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
      { signedIn },
    );

  it('read-only sessions say so; full sessions do not', () => {
    shell({ readOnly: true });
    expect(screen.getByTestId('read-only-badge').textContent).toMatch(/read-only/i);
    cleanup();
    shell(true);
    expect(screen.queryByTestId('read-only-badge')).toBeNull();
  });

  it('Sign out forgets the token and brings the token screen back', async () => {
    serveAuth('good');
    renderWithQuery(
      <MemoryRouter initialEntries={['/?token=good']}>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </MemoryRouter>,
      { signedIn: false },
    );
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(readToken()).toBeUndefined());
    expect(await screen.findByLabelText('Access token')).toBeTruthy();
  });
});
