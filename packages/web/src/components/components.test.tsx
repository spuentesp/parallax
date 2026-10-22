import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssessmentView } from '../components/AssessmentView.js';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { ServiceMap } from '../components/ServiceMap.js';

afterEach(() => cleanup());

describe('stub components', () => {
  it('ServiceMap shows the map label', () => {
    render(<ServiceMap />);
    expect(screen.getByRole('region', { name: /service map/i })).toBeTruthy();
  });
  it('AssessmentView shows the assessment id', () => {
    render(<AssessmentView assessmentId="a_1" />);
    expect(screen.getByRole('article').textContent).toContain('a_1');
  });
});

describe('EvidencePanel', () => {
  it('shows the empty hint when there is nothing to resolve', () => {
    render(<EvidencePanel />);
    expect(screen.getByText(/no citations to resolve/i)).toBeTruthy();
  });

  it('opens the cited code and marks the exact line', () => {
    render(
      <EvidencePanel
        items={[
          {
            exists: true,
            ref: 'billing:HttpClientCall:src/main.py:GET /api/orders/{}:21',
            node: {
              id: 'billing:HttpClientCall:src/main.py:GET /api/orders/{}:21',
              node_type: 'HttpClientCall',
              ref: {
                commit: '972651746b73f234031e3eae3c7b71b5d255d0ef',
                id: 'billing:HttpClientCall:src/main.py:GET /api/orders/{}:21',
                line: 21,
                path: 'src/main.py',
                repo: 'billing',
              },
            },
            source: {
              text: 'def get_order(oid):\n    r = httpx.get(f"{ORDERS_URL}/api/orders/{oid}")\n    return r.json()',
              path: 'src/main.py',
              start: 19,
              end: 22,
              commit: '972651746b73f234031e3eae3c7b71b5d255d0ef',
              total_lines: 53,
            },
          },
        ]}
      />,
    );
    // La cita lleva al código y a la versión que la sostiene.
    const panel = screen.getByTestId('evidence-panel');
    expect(panel.textContent).toContain('billing');
    expect(panel.textContent).toContain('972651746b');
    expect(panel.textContent).toContain('src/main.py');
    expect(screen.getByText(/resuelta/i)).toBeTruthy();
    expect(screen.getByText(/httpx\.get/)).toBeTruthy();
    // La línea citada queda marcada.
    expect(panel.querySelector('[data-cited="true"]')).toBeTruthy();
    expect(screen.getByText(/def get_order/)).toBeTruthy();
  });

  it('keeps an unresolvable ref visible with its reason (INV 3)', () => {
    render(
      <EvidencePanel
        items={[
          {
            exists: false,
            ref: 'billing@deadbeef:src/gone.py:1',
            reason: 'path not found at commit',
          },
        ]}
      />,
    );
    expect(screen.getByText(/no resuelve/i)).toBeTruthy();
    expect(screen.getByText(/path not found at commit/i)).toBeTruthy();
  });
});
