import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMapSearch } from '../api/hooks.js';

// Paleta de comandos (Ctrl/⌘ K desde cualquier pantalla del workspace): un solo
// campo que enruta a Preguntar (el asistente), Ir a (secciones y nodos del
// mapa) y Acciones. Sólo ofrece lo que la app puede hacer hoy: no hay un
// servicio de consultas guardadas, así que "Run query" no existe aquí.

/** Cualquier parte de la interfaz puede abrir la paleta sin conocer su estado. */
export const OPEN_PALETTE_EVENT = 'parallax:open-palette';

interface Item {
  id: string;
  group: 'Ask' | 'Go to' | 'Actions';
  label: string;
  hint?: string;
  run: () => void;
}

const SECTIONS = [
  { label: 'Map', path: '' },
  { label: 'Repositories', path: '/repos' },
  { label: 'Contracts', path: '/contracts' },
  { label: 'Assessments', path: '/assessments' },
  { label: 'Coverage', path: '/coverage' },
] as const;

export function CommandPalette({ orgId }: { orgId: string }): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/orgs/${orgId}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setText('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const term = text.trim();
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 200);
    return () => clearTimeout(t);
  }, [term]);
  const nodes = useMapSearch(open ? orgId : undefined, debounced).data?.results ?? [];

  const items = useMemo<Item[]>(() => {
    const close = () => setOpen(false);
    const go = (to: string) => () => {
      close();
      navigate(to);
    };
    const out: Item[] = [];
    if (term) {
      out.push({
        id: 'ask',
        group: 'Ask',
        label: `Ask the assistant: “${term}”`,
        hint: '↵',
        run: () => {
          close();
          // En el mapa se conserva lo que se ve (foco, selección, filtros).
          if (location.pathname === base) {
            const next = new URLSearchParams(location.search);
            next.set('ask', term);
            navigate(`${base}?${next}`);
          } else navigate(`${base}?ask=${encodeURIComponent(term)}`);
        },
      });
    }
    const q = term.toLowerCase();
    for (const s of SECTIONS) {
      if (q === '' || s.label.toLowerCase().includes(q)) {
        out.push({
          id: `sec:${s.label}`,
          group: 'Go to',
          label: s.label,
          hint: 'section',
          run: go(`${base}${s.path}`),
        });
      }
    }
    for (const n of nodes.slice(0, 6)) {
      out.push({
        id: `node:${n.id}`,
        group: 'Go to',
        label: n.label,
        hint: n.kind,
        run: go(`${base}?sel=${encodeURIComponent(n.id)}`),
      });
    }
    if (q === '' || 'assess a pull request'.includes(q) || 'evaluate pr'.includes(q)) {
      out.push({
        id: 'assess',
        group: 'Actions',
        label: 'Assess a pull request…',
        run: go(`${base}/assessments`),
      });
    }
    return out;
  }, [term, nodes, navigate, base, location.pathname, location.search]);

  if (!open) return null;
  const clamp = Math.min(active, Math.max(items.length - 1, 0));
  const groups = (['Ask', 'Go to', 'Actions'] as const).filter((g) =>
    items.some((i) => i.group === g),
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[14vh]">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="Command bar"
          placeholder="Ask anything about the architecture"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((clamp + 1) % Math.max(items.length, 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((clamp - 1 + items.length) % Math.max(items.length, 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              items[clamp]?.run();
            }
          }}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted/70"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1" role="listbox" aria-label="Commands">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wider text-muted">
                {g}
              </div>
              {items
                .filter((i) => i.group === g)
                .map((i) => {
                  const selected = items[clamp]?.id === i.id;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(items.indexOf(i))}
                      onClick={i.run}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                        selected ? 'bg-accent-soft text-accent' : 'text-fg'
                      }`}
                    >
                      <span className="truncate">{i.label}</span>
                      {i.hint && <span className="ml-auto text-xs text-muted">{i.hint}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted">
          <kbd className="rounded border border-border px-1">↑</kbd>{' '}
          <kbd className="rounded border border-border px-1">↓</kbd> to move ·{' '}
          <kbd className="rounded border border-border px-1">↵</kbd> to choose ·{' '}
          <kbd className="rounded border border-border px-1">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
