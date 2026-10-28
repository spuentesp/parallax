import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './ContextPanel.js';

afterEach(() => cleanup());

describe('ContextPanel', () => {
  it('renders title and children, and calls onClose', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ContextPanel title="Service orders" onClose={onClose}>
          <p>panel-body</p>
        </ContextPanel>
      </MemoryRouter>,
    );
    expect(screen.getByText('Service orders')).toBeTruthy();
    expect(screen.getByText('panel-body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
