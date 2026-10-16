import { cleanup, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../router.js';
import { sampleReport, server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';

afterEach(() => {
  cleanup();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('frontend race conditions (out-of-order responses)', () => {
  it('a late stale response never overwrites the current view', async () => {
    server.use(
      http.get('/api/assessments/a_slow', async () => {
        await sleep(80);
        return HttpResponse.json({
          assessment: { ...sampleReport, id: 'a_slow', status: 'FAILED' },
        });
      }),
      http.get('/api/assessments/a_fast', () =>
        HttpResponse.json({
          assessment: { ...sampleReport, id: 'a_fast', status: 'READY' },
        }),
      ),
    );

    const router = createMemoryRouter(routes, {
      initialEntries: ['/orgs/acme/assessments/a_slow'],
    });
    renderWithQuery(<RouterProvider router={router} />);

    // El usuario navega al segundo informe antes de que el primero responda.
    await router.navigate('/orgs/acme/assessments/a_fast');
    expect(await screen.findByText('READY')).toBeTruthy();

    // Cuando la respuesta vieja llega tarde, jamás pisa el estado nuevo.
    await sleep(150);
    expect(screen.getByText('READY')).toBeTruthy();
    expect(screen.queryByText('FAILED')).toBeNull();
  });

  it('interleaved ?repo updates always converge to the newest context', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/orgs/acme/assessments?repo=first'],
    });
    renderWithQuery(<RouterProvider router={router} />);

    // Dos navegaciones encadenadas; el formulario debe quedar con la última.
    await router.navigate('/orgs/acme/assessments?repo=second');
    await router.navigate('/orgs/acme/assessments?repo=third');
    await waitFor(() => {
      const field = screen.getByLabelText(/repo/i) as HTMLInputElement;
      expect(field.value).toBe('third');
    });
  });
});
