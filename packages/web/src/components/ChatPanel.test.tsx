import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChatMessage, ChatPanel } from './ChatPanel.js';

afterEach(cleanup);

const focus = {
  seed: 'svc:orders',
  ids: ['svc:orders', 'svc:billing'],
  relations: [],
  query: '?x',
};
const claims = {
  total: 3,
  verified: 2,
  contradicted: 1,
  unverifiable: 0,
  supported: 0,
  unsupported: 0,
};

function setup(messages: ChatMessage[] = [], over: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const onSend = vi.fn();
  const onShowOnMap = vi.fn();
  render(
    <ChatPanel
      messages={messages}
      onSend={onSend}
      loading={false}
      onShowOnMap={onShowOnMap}
      {...over}
    />,
  );
  return { onSend, onShowOnMap };
}
const input = () => screen.getByLabelText('Ask about your architecture') as HTMLInputElement;

describe('ChatPanel', () => {
  it('shows the empty-state prompt only without messages', () => {
    setup();
    expect(screen.getByText(/ask something like/i)).toBeTruthy();
    cleanup();
    setup([{ role: 'user', content: 'hi' }]);
    expect(screen.queryByText(/ask something like/i)).toBeNull();
  });

  it('sends trimmed text on Enter and on click, then clears the box', () => {
    const { onSend } = setup();
    fireEvent.change(input(), { target: { value: '  who consumes orders?  ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('who consumes orders?');
    expect(input().value).toBe('');
    fireEvent.change(input(), { target: { value: 'again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenLastCalledWith('again');
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('ignores other keys, blank input, and everything while loading', () => {
    const { onSend } = setup();
    fireEvent.change(input(), { target: { value: 'x' } });
    fireEvent.keyDown(input(), { key: 'a' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: '   ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const loading = setup([], { loading: true });
    fireEvent.change(input(), { target: { value: 'x' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(loading.onSend).not.toHaveBeenCalled();
    expect(screen.getByText('Investigating…')).toBeTruthy();
    expect((screen.getByRole('button', { name: '…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not say it is investigating when it is not', () => {
    setup([{ role: 'user', content: 'q' }]);
    expect(screen.queryByText('Investigating…')).toBeNull();
  });

  it('aligns user and assistant messages differently', () => {
    setup([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ]);
    expect(screen.getByText('question').closest('.justify-end')).toBeTruthy();
    expect(screen.getByText('answer').closest('.justify-start')).toBeTruthy();
    expect(screen.getByText('answer').closest('.justify-end')).toBeNull();
  });

  it('shows engine verdicts for an answer, not for a question or an empty tally', () => {
    setup([
      { role: 'assistant', content: 'a', claims },
      { role: 'assistant', content: 'b', claims: { ...claims, total: 0 } },
      { role: 'user', content: 'c', claims },
    ]);
    const summaries = screen.getAllByTestId('claims-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.textContent).toBe('2 verified · 1 contradicted · 0 unverifiable');
  });

  it('shows a failed explanation status but never a healthy one', () => {
    setup([
      { role: 'assistant', content: 'a', status: 'failed:no_model_configured' },
      { role: 'assistant', content: 'b', status: 'complete' },
      { role: 'user', content: 'c', status: 'failed:x' },
    ]);
    expect(screen.getAllByText(/^Explanation:/)).toHaveLength(1);
    expect(screen.getByText('Explanation: failed:no_model_configured')).toBeTruthy();
  });

  it('offers "Show on map" only for an assistant message with a focus and a handler', () => {
    const { onShowOnMap } = setup([
      { role: 'assistant', content: 'a', focus },
      { role: 'assistant', content: 'b', focus: null },
      { role: 'user', content: 'c', focus },
    ]);
    const btn = screen.getByRole('button', { name: 'Show on map · 2 nodes' });
    fireEvent.click(btn);
    expect(onShowOnMap).toHaveBeenCalledWith(focus);
    expect(screen.getAllByRole('button', { name: /show on map/i })).toHaveLength(1);
    cleanup();
    render(
      <ChatPanel
        messages={[{ role: 'assistant', content: 'a', focus }]}
        onSend={() => {}}
        loading={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /show on map/i })).toBeNull();
  });

  it('lists each claim with the engine verdict and reason, and only for answers that have any', () => {
    setup([
      {
        role: 'assistant',
        content: 'a',
        verdicts: [
          {
            claim: {
              kind: 'relation',
              consumer: 'billing',
              provider: 'orders',
              polarity: 'present',
            },
            verdict: 'verified',
            reason: 'engine records 3 use(s)',
            engine: { uses: 3, endpoints: [], complete: true },
          },
          {
            claim: {
              kind: 'relation',
              consumer: 'reports',
              provider: 'orders',
              polarity: 'absent',
            },
            verdict: 'contradicted',
            reason: 'engine records 1 use(s) of orders by reports',
            engine: { uses: 1, endpoints: [], complete: true },
          },
          {
            claim: { kind: 'note', text: 'orders is central' },
            verdict: 'unsupported',
            reason: 'no cited evidence',
          },
        ],
      },
      { role: 'assistant', content: 'b', verdicts: [] },
      {
        role: 'user',
        content: 'c',
        verdicts: [{ claim: { kind: 'note', text: 'x' }, verdict: 'supported', reason: 'r' }],
      },
    ]);
    const boxes = screen.getAllByTestId('verdicts');
    expect(boxes).toHaveLength(1);
    const box = within(boxes[0] as HTMLElement);
    expect(box.getByText('billing → orders')).toBeTruthy();
    expect(box.getByText('reports ↛ orders')).toBeTruthy();
    expect(box.getByText('orders is central')).toBeTruthy();
    expect(box.getByText('verified').className).toMatch(/text-success/);
    expect(box.getByText('contradicted').className).toMatch(/text-error/);
    expect(box.getByText('unsupported').className).toMatch(/text-warning/);
    expect(box.getByText('· 3 uses')).toBeTruthy();
    expect(box.getByText('· 1 use')).toBeTruthy();
    expect(box.getByText('engine records 1 use(s) of orders by reports')).toBeTruthy();
  });
});
