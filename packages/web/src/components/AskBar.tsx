import type * as React from 'react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { OPEN_PALETTE_EVENT } from './CommandPalette.js';

// Barra de pregunta al pie del mapa (referencia "Ask / Query"). La pregunta se
// la entrega al asistente por ?ask= (él la envía una vez, abre el hilo y retira
// el parámetro), así que hay UN solo camino de preguntar: esta barra, la paleta
// y "Ask about this" acaban en el mismo sitio.
const GENERIC = [
  'Which services are most connected?',
  'Where are the loose ends?',
  'Who consumes the orders API?',
];

export function AskBar({
  selectedName,
}: {
  selectedName?: string | undefined;
}): React.ReactElement {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { orgId } = useParams();
  const [text, setText] = useState('');
  const suggestions = selectedName
    ? [
        `Who depends on ${selectedName}?`,
        `What breaks if I change ${selectedName}?`,
        `Show unresolved calls around ${selectedName}`,
        ...GENERIC.slice(0, 1),
      ]
    : GENERIC;

  const send = (question: string) => {
    const q = question.trim();
    if (!q) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('ask', q);
        return next;
      },
      { replace: false },
    );
    setText('');
  };

  return (
    <div className="border-t border-border bg-surface px-4 py-3" data-testid="ask-bar">
      <form
        className="flex items-center gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <fieldset
          className="m-0 flex shrink-0 overflow-hidden rounded-lg border border-border-strong p-0 text-xs"
          aria-label="Command mode"
        >
          <button
            type="button"
            aria-pressed="true"
            className="bg-accent-soft px-3 py-1.5 font-medium text-accent"
          >
            Ask
          </button>
          <button
            type="button"
            disabled={!orgId}
            title="Build a pipeline over the engine's graph"
            onClick={() => orgId && navigate(`/orgs/${orgId}/query`)}
            className="bg-surface-2 px-3 py-1.5 text-muted hover:text-fg"
          >
            Query
          </button>
        </fieldset>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Ask about the architecture"
          placeholder="Ask about code, contracts, repos or the org."
          className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-2 px-3 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
        />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
          title="Open the command palette"
          className="hidden shrink-0 rounded-lg border border-border-strong px-2.5 py-1.5 font-mono text-xs text-muted hover:text-fg sm:block"
        >
          Ctrl K
        </button>
      </form>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-full border border-border-strong px-3 py-1.5 text-xs transition-colors hover:border-accent hover:text-accent"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
