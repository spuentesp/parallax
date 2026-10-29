import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { useOpenPrs } from '../api/hooks.js';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { CiSettingsPanel } from './CiSettingsPanel.js';

afterEach(() => {
  cleanup();
});

describe('CiSettingsPanel', () => {
  it('shows the stored settings, off by default', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);

    const mode = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(mode.value).toBe('off');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('saves the mode, the branch filter and the comment option', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.put('/api/workspaces/ws1/ci', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(body as Record<string, unknown>);
      }),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);

    fireEvent.change(await screen.findByRole('combobox'), {
      target: { value: 'on-open-and-update' },
    });
    fireEvent.change(screen.getByPlaceholderText('any branch'), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(body).toEqual({
      mode: 'on-open-and-update',
      baseBranch: 'main',
      reportComments: true,
    });
  });

  it('sends a blank branch filter as null, meaning any branch', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({
          mode: 'on-open-and-update',
          baseBranch: 'release',
          reportComments: false,
        }),
      ),
      http.put('/api/workspaces/ws1/ci', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(body as Record<string, unknown>);
      }),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);

    const branch = await screen.findByPlaceholderText('any branch');
    fireEvent.change(branch, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ baseBranch: null });
  });

  it('shows the loading text until the settings arrive', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/workspaces/ws1/ci', async () => {
        await gate;
        return HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false });
      }),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    release();
    expect(await screen.findByRole('combobox')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows a failed load as an error line and no form', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ title: 'boom' }, { status: 500 }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    await waitFor(() => expect(document.querySelector('p.text-error')).not.toBeNull());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('pre-fills the branch filter with the stored branch', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({
          mode: 'on-open-and-update',
          baseBranch: 'release',
          reportComments: true,
        }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    const branch = (await screen.findByPlaceholderText('any branch')) as HTMLInputElement;
    expect(branch.value).toBe('release');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('trims surrounding spaces from a branch filter before saving', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.put('/api/workspaces/ws1/ci', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(body as Record<string, unknown>);
      }),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    fireEvent.change(await screen.findByPlaceholderText('any branch'), {
      target: { value: '  main  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ baseBranch: 'main' });
  });

  it('prevents the native form submit and refreshes the stored settings after a save', async () => {
    let gets = 0;
    server.use(
      http.get('/api/workspaces/ws1/ci', () => {
        gets += 1;
        return HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false });
      }),
      http.put('/api/workspaces/ws1/ci', async ({ request }) =>
        HttpResponse.json((await request.json()) as Record<string, unknown>),
      ),
    );
    const { container } = renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    await screen.findByRole('combobox');
    const form = container.querySelector('form') as HTMLFormElement;
    const notCancelled = fireEvent.submit(form);
    expect(notCancelled).toBe(false);
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it('labels the save button while the save is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.put('/api/workspaces/ws1/ci', async ({ request }) => {
        await gate;
        return HttpResponse.json((await request.json()) as Record<string, unknown>);
      }),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy());
  });

  it('shows a failed save as an error next to the button', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.put('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ title: 'nope' }, { status: 400 }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const line = await waitFor(() => {
      const el = document.querySelector('span.text-error');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toContain('api 400');
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('leaves the branch filter empty when none is stored', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    const branch = (await screen.findByPlaceholderText('any branch')) as HTMLInputElement;
    expect(branch.value).toBe('');
  });

  it('saves only the CI settings, leaving other cached listings alone', async () => {
    let prListings = 0;
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
      http.get('/api/workspaces/ws1/prs', () => {
        prListings += 1;
        return HttpResponse.json({ prs: [], skipped: [], errors: [], truncated: [] });
      }),
      http.put('/api/workspaces/ws1/ci', async ({ request }) =>
        HttpResponse.json((await request.json()) as Record<string, unknown>),
      ),
    );
    function OtherListing() {
      useOpenPrs('ws1');
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CiSettingsPanel orgId="ws1" />
        <OtherListing />
      </QueryClientProvider>,
    );
    await screen.findByRole('combobox');
    await waitFor(() => expect(prListings).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await new Promise((r) => setTimeout(r, 50));
    expect(prListings).toBe(1);
  });

  it('styles the branch filter input with its focus ring', async () => {
    server.use(
      http.get('/api/workspaces/ws1/ci', () =>
        HttpResponse.json({ mode: 'off', baseBranch: null, reportComments: false }),
      ),
    );
    renderWithQuery(<CiSettingsPanel orgId="ws1" />);
    const branch = await screen.findByPlaceholderText('any branch');
    expect(branch.className).toContain('focus:ring-2');
  });
});
