import { cleanup, fireEvent, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../test/msw.js';
import { renderWithQuery } from '../test/render.js';
import { ContractEditor } from './ContractEditor.js';

afterEach(() => cleanup());

describe('ContractEditor', () => {
  it('previews and applies native Lain contract context through HTTP', async () => {
    const bodies: Array<{ dry_run: boolean; snapshot: string }> = [];
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', async ({ request }) => {
        const body = (await request.json()) as { dry_run: boolean; snapshot: string };
        bodies.push(body);
        return HttpResponse.json(
          body.dry_run
            ? { applied: false, dry_run: true, yaml: 'provides:\n  - service: api\n' }
            : {
                applied: true,
                dry_run: false,
                backup: '/tmp/repos.yaml.bak',
                yaml: 'provides:\n  - service: api\n',
              },
        );
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect((await screen.findByTestId('remediation-result')).textContent).toBe('Dry-run preview');
    expect(screen.getByTestId('contract-preview').textContent).toContain('service: api');

    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect((await screen.findByTestId('remediation-result')).textContent).toBe('Applied by Lain');
    expect(screen.getByText(/repos.yaml.bak/)).toBeTruthy();
    expect(bodies.map((body) => [body.snapshot, body.dry_run])).toEqual([
      ['live', true],
      ['live', false],
    ]);
  });

  it('shows invalid JSON without sending a write request', async () => {
    let writes = 0;
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', () => {
        writes++;
        return HttpResponse.json({});
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText('Context JSON'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/Expected property name|unexpected token/i)).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('validates the native declaration schema before writing', async () => {
    let writes = 0;
    server.use(
      http.post('/api/workspaces/ws1/contracts/remediation', () => {
        writes++;
        return HttpResponse.json({});
      }),
    );
    renderWithQuery(<ContractEditor workspaceId="ws1" />);
    fireEvent.change(screen.getByLabelText('Context JSON'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/at least one contract declaration/i)).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('does not offer writes to a read-only session', () => {
    renderWithQuery(<ContractEditor workspaceId="ws1" />, { signedIn: { readOnly: true } });
    expect(screen.getByRole('button', { name: 'Preview changes' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Apply changes' })).toHaveProperty('disabled', true);
  });
});
