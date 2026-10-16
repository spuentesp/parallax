import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleReport, server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { AssessmentForm } from './AssessmentForm.js';

afterEach(() => {
  cleanup();
});

describe('AssessmentForm', () => {
  it('preselects the repo from props and submits the typed SHAs to the API', async () => {
    let posted: unknown = null;
    server.use(
      http.post('/api/assessments', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ assessment: sampleReport, created: true });
      }),
    );
    renderWithQuery(<AssessmentForm orgId="acme" preselectedRepo="orders" />);
    expect((screen.getByLabelText(/repo/i) as HTMLInputElement).value).toBe('orders');
    fireEvent.change(screen.getByLabelText(/base/i), {
      target: { value: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' },
    });
    fireEvent.change(screen.getByLabelText(/head/i), {
      target: { value: 'afece2321df86647a31d073a2e3cadb50e13d42e' },
    });
    fireEvent.click(screen.getByRole('button', { name: /evaluar/i }));
    await waitFor(() => {
      expect(posted).toEqual({
        repo: 'orders',
        base: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
        head: 'afece2321df86647a31d073a2e3cadb50e13d42e',
        orgId: 'acme',
      });
    });
  });
});
