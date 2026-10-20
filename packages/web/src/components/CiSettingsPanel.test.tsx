import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
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
});
