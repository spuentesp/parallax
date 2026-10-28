import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowActions } from './FlowActions.js';

afterEach(cleanup);

const renderIt = (selected?: Parameters<typeof FlowActions>[0]['selectedNode']) =>
  render(
    <MemoryRouter>
      <FlowActions orgId="acme" selectedNode={selected} />
    </MemoryRouter>,
  );

describe('FlowActions', () => {
  it('without a selection, evaluates with an empty repo and says nothing about one', () => {
    renderIt();
    const evaluate = screen.getByRole('link', { name: 'Evaluate PR' });
    expect(evaluate.getAttribute('href')).toBe('/orgs/acme/assessments?repo=');
    // Lo demás (configurar, ver evaluaciones) vive en la barra lateral, no aquí.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('with a selection, names it and url-encodes it into the form link', () => {
    renderIt({ kind: 'service', name: 'orders api/v2' });
    const evaluate = screen.getByRole('link', { name: 'Evaluate PR · orders api/v2' });
    expect(evaluate.getAttribute('href')).toBe('/orgs/acme/assessments?repo=orders%20api%2Fv2');
  });

  it('a null selection behaves like none', () => {
    renderIt(null);
    expect(screen.getByRole('link', { name: 'Evaluate PR' })).toBeTruthy();
  });
});
