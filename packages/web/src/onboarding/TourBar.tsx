import type * as React from 'react';
import { useState } from 'react';
import { CHAPTERS, DEFAULT_TASK, ROLE_LABEL, type Role } from './chapters.js';
import type { TourState } from './useOnboarding.js';

/** Antes de empezar: quién eres y qué vienes a hacer. */
export function TourSetup({
  onStart,
  onCancel,
}: {
  onStart: (role: Role, task: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [role, setRole] = useState<Role>('fullstack');
  const [task, setTask] = useState(DEFAULT_TASK);
  return (
    <div
      className="space-y-2 rounded-xl border border-border bg-bg p-3 text-xs"
      data-testid="tour-setup"
    >
      <p className="font-semibold">Guided tour</p>
      <p className="text-muted">
        {CHAPTERS.length} short chapters, from &quot;what is this&quot; to &quot;where do I
        start&quot;. Tell me who you are and what you are here to do, and I will aim the answers at
        it.
      </p>
      <fieldset className="flex gap-1.5 border-0 p-0">
        <legend className="mb-1 text-muted">I work on</legend>
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={role === r}
            onClick={() => setRole(r)}
            className={`rounded-full px-2.5 py-0.5 ${role === r ? 'bg-accent text-accent-fg' : 'bg-surface text-muted hover:bg-border'}`}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-muted">My first task</span>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1 outline-none focus:border-accent"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onStart(role, task)}
          className="rounded-lg bg-accent px-3 py-1 text-accent-fg"
        >
          Start
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1 text-muted hover:bg-border"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** Durante el recorrido: dónde vas, y a dónde puedes saltar. */
export function TourBar({
  state,
  busy,
  onGo,
  onFinish,
  onLeave,
}: {
  state: TourState;
  busy: boolean;
  onGo: (n: number) => void;
  onFinish: () => void;
  onLeave: () => void;
}): React.ReactElement {
  const idx = CHAPTERS.findIndex((c) => c.n === state.current);
  const next = idx >= 0 ? CHAPTERS[idx + 1] : undefined;
  const here = idx >= 0 ? CHAPTERS[idx] : undefined;
  return (
    <div className="space-y-1.5 border-b border-border px-4 py-2" data-testid="tour-bar">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted">
          Tour · {ROLE_LABEL[state.role]} · <span className="text-fg">{state.task}</span>
        </span>
        <button type="button" onClick={onLeave} className="text-muted hover:text-fg">
          Leave tour
        </button>
      </div>
      <ol className="flex flex-wrap gap-1" aria-label="Chapters">
        {CHAPTERS.map((c) => {
          const done = state.done.includes(c.n);
          const current = state.current === c.n;
          return (
            <li key={c.n}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onGo(c.n)}
                aria-current={current ? 'step' : undefined}
                title={c.asks}
                className={`rounded-full px-2 py-0.5 text-[11px] disabled:opacity-50 ${
                  current
                    ? 'bg-accent text-accent-fg'
                    : done
                      ? 'bg-success/15 text-success'
                      : 'bg-bg text-muted hover:bg-border'
                }`}
              >
                {done ? '✓ ' : ''}
                {c.n}. {c.title}
              </button>
            </li>
          );
        })}
      </ol>
      {here && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted">{here.asks}</span>
          {next ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onGo(next.n)}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-accent-fg disabled:opacity-50"
            >
              Next: {next.title} →
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onFinish}
              className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-accent-fg disabled:opacity-50"
            >
              Finish tour
            </button>
          )}
        </div>
      )}
    </div>
  );
}
