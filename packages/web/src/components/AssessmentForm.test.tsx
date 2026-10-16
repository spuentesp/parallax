import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssessmentForm } from './AssessmentForm.js';

const mutateMock = vi.fn();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
vi.mock('../api/hooks.js', () => ({
  useCreateAssessment: () => ({ mutate: mutateMock }),
}));

describe('AssessmentForm', () => {
  it('preselects the repo from props and submits with the typed SHAs', () => {
    render(
      <MemoryRouter>
        <AssessmentForm orgId="acme" preselectedRepo="orders" />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText(/repo/i) as HTMLInputElement).value).toBe('orders');
    fireEvent.change(screen.getByLabelText(/base/i), {
      target: { value: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf' },
    });
    fireEvent.change(screen.getByLabelText(/head/i), {
      target: { value: 'afece2321df86647a31d073a2e3cadb50e13d42e' },
    });
    fireEvent.click(screen.getByRole('button', { name: /evaluar/i }));
    expect(mutateMock).toHaveBeenCalledWith({
      repo: 'orders',
      base: 'b5bf29ad1d5d6b84ef9655ee7a035a4a5c8523cf',
      head: 'afece2321df86647a31d073a2e3cadb50e13d42e',
      orgId: 'acme',
    });
  });
});
