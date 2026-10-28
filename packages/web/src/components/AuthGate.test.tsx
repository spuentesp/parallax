import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { clearToken, readToken } from '../api/token.js';
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
const gate = () =>
  renderWithQuery(
    <AuthGate>
      <p>inside</p>
    </AuthGate>,
    { signedIn: false },
  );

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
    window.history.replaceState(null, '', '/orgs/acme?token=linked&sel=svc%3Aa');
    gate();
    expect(await screen.findByText('inside')).toBeTruthy();
    expect(seen[0]).toBe('Bearer linked');
    expect(window.location.search).toBe('?sel=svc%3Aa');
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
    window.history.replaceState(null, '', '/?token=good');
    renderWithQuery(
      <MemoryRouter>
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
