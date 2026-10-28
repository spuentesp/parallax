import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type {
  AskResponse,
  ClaimVerdictDto,
  ConversationSummaryDto,
  MapFocusDto,
  ProgressEventDto,
  RoadmapDto,
} from '../api/hooks.js';
import { RoadmapView } from '../trace/RoadmapView.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Veredictos del motor sobre lo que afirma la respuesta. */
  claims?: AskResponse['claims_summary'];
  /** Cada afirmación con lo que dijo el motor (para poder verla, no sólo contarla). */
  verdicts?: ClaimVerdictDto[];
  /** A dónde llevar al usuario en el mapa; sólo lo que un recibo respalda. */
  focus?: MapFocusDto | null;
  /** Recorrido de un dato o radio de impacto, dibujado bajo la respuesta. */
  roadmap?: RoadmapDto;
  /** Estado de la explicación del modelo (p. ej. failed:no_model_configured). */
  status?: string;
  /** Recorrido guiado: cabecera de capítulo, y (si es una tarjeta) cuál. */
  label?: string;
  card?: 'orient' | 'doors';
}

export function ChatPanel({
  messages,
  onSend,
  loading,
  onShowOnMap,
  conversations = [],
  activeId = null,
  onNew,
  onOpen,
  onDelete,
  notice,
  docked = false,
  onClose,
  topSlot,
  renderCard,
  onStartTour,
  progress = [],
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  loading: boolean;
  onShowOnMap?: (focus: MapFocusDto) => void;
  /** Mis conversaciones de este workspace (la memoria vive en el servidor). */
  conversations?: ConversationSummaryDto[];
  activeId?: string | null;
  onNew?: () => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Aviso bajo la cabecera (p. ej. una conversación que ya no existe). */
  notice?: string | null;
  /** Pegado al borde de la pantalla (sin tarjeta flotante). */
  docked?: boolean;
  /** Cierra el panel (sólo si se puede ocultar). */
  onClose?: () => void;
  /** Entre la cabecera y la conversación (la barra del recorrido guiado). */
  topSlot?: React.ReactNode;
  /** Pinta una tarjeta determinista (sin modelo) dentro de la conversación. */
  renderCard?: (card: NonNullable<ChatMessage['card']>) => React.ReactNode;
  /** Ofrece empezar el recorrido guiado cuando no hay conversación. */
  onStartTour?: () => void;
  /** Lo que el investigador va haciendo mientras responde (en vivo). */
  progress?: ProgressEventDto[];
}): React.ReactElement {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: baja al último mensaje cuando llega uno
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length, loading]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput('');
  };

  return (
    <div
      className={`flex flex-col h-full bg-surface ${docked ? '' : 'rounded-xl border border-border shadow-lg'}`}
    >
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Ask the architecture</div>
            <div className="text-[11px] text-muted leading-snug">
              Answers are checked against the engine; what it confirms can be shown on the map.
            </div>
          </div>
          {onNew && (
            <button
              type="button"
              onClick={onNew}
              disabled={loading}
              className="shrink-0 px-2.5 py-1 rounded-lg text-xs border border-border hover:bg-bg disabled:opacity-50"
            >
              New
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide assistant"
              title="Hide assistant"
              className="shrink-0 px-1.5 py-1 rounded-lg text-xs text-muted hover:bg-bg hover:text-fg"
            >
              ✕
            </button>
          )}
        </div>
        {conversations.length > 0 && (
          <details className="text-xs" data-testid="conversation-list">
            <summary className="cursor-pointer text-muted hover:text-fg">
              Earlier conversations ({conversations.length})
            </summary>
            <ul className="mt-1.5 max-h-36 overflow-y-auto space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpen?.(c.id)}
                    aria-current={c.id === activeId ? 'true' : undefined}
                    className={`flex-1 text-left truncate rounded px-2 py-1 hover:bg-bg ${
                      c.id === activeId ? 'bg-accent/10 text-accent' : ''
                    }`}
                    title={c.title}
                  >
                    {c.title}
                    <span className="text-muted"> · {c.turns}</span>
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      aria-label={`Delete conversation ${c.title}`}
                      onClick={() => onDelete(c.id)}
                      className="px-1.5 text-muted hover:text-error"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        {notice && (
          <p className="text-xs text-warning" role="status">
            {notice}
          </p>
        )}
      </div>

      {topSlot}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !topSlot && (
          <div className="text-center text-sm py-8 text-muted">
            <div>Ask something like:</div>
            <div className="italic mt-1">“Who consumes the orders API?”</div>
            {onStartTour && (
              <button
                type="button"
                onClick={onStartTour}
                className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg"
              >
                New here? Take the guided tour
              </button>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: la conversación sólo se añade al final
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`rounded-xl px-3 py-2 text-sm max-w-[90%] space-y-2 ${
                m.role === 'user'
                  ? 'bg-accent text-accent-fg'
                  : 'bg-bg text-fg border border-border'
              }`}
            >
              {m.label && <p className="text-xs font-semibold">{m.label}</p>}
              {m.card && renderCard ? (
                renderCard(m.card)
              ) : m.label && m.role === 'user' ? (
                <details className="text-[11px] opacity-90">
                  <summary className="cursor-pointer">What I asked</summary>
                  <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
                </details>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === 'assistant' && m.roadmap && <RoadmapView roadmap={m.roadmap} />}
              {m.role === 'assistant' && m.claims && m.claims.total > 0 && (
                <p className="text-[11px] text-muted" data-testid="claims-summary">
                  {summaryParts(m.claims).map((p, i) => (
                    <span key={p.label} title={p.meaning} className={p.tone}>
                      {i > 0 ? ' · ' : ''}
                      {p.count} {p.label}
                    </span>
                  ))}
                </p>
              )}
              {m.role === 'assistant' && m.verdicts && m.verdicts.length > 0 && (
                <Verdicts verdicts={m.verdicts} />
              )}
              {m.role === 'assistant' && m.status && m.status.startsWith('failed') && (
                <p className="text-[11px] text-warning">Explanation: {m.status}</p>
              )}
              {m.role === 'assistant' && m.focus && onShowOnMap && (
                <button
                  type="button"
                  onClick={() => m.focus && onShowOnMap(m.focus)}
                  className="px-2.5 py-1 rounded-full text-xs bg-accent text-accent-fg"
                >
                  Show on map · {m.focus.ids.length} nodes
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && <Investigating progress={progress} />}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex gap-2 rounded-lg p-2 bg-bg">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask about your architecture…"
            aria-label="Ask about your architecture"
            className="flex-1 text-sm bg-transparent outline-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="px-3 py-1 rounded-md text-sm font-medium bg-accent text-accent-fg disabled:opacity-50"
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cuenta los veredictos del motor (para el resumen de una respuesta guardada). */
export function summarizeVerdicts(v: readonly ClaimVerdictDto[]): AskResponse['claims_summary'] {
  const n = (x: ClaimVerdictDto['verdict']) => v.filter((c) => c.verdict === x).length;
  return {
    total: v.length,
    verified: n('verified'),
    contradicted: n('contradicted'),
    unverifiable: n('unverifiable'),
    supported: n('supported'),
    unsupported: n('unsupported'),
  };
}

const VERDICT_STYLE: Record<ClaimVerdictDto['verdict'], string> = {
  verified: 'text-success',
  supported: 'text-success',
  contradicted: 'text-error',
  unverifiable: 'text-warning',
  unsupported: 'text-warning',
};

/**
 * El resumen dice lo que HAY, sin ceros que confundan: "0 verified" junto a 4
 * afirmaciones respaldadas por evidencia parecía que nada se había comprobado.
 * `verified`/`contradicted` los adjudica el motor por sí mismo; `supported` es
 * "cita evidencia que el motor entregó", no una comprobación independiente.
 */
export function summaryParts(
  c: AskResponse['claims_summary'],
): Array<{ count: number; label: string; meaning: string; tone: string }> {
  return [
    {
      count: c.verified,
      label: 'verified',
      meaning: 'The engine checked it itself',
      tone: 'text-success',
    },
    {
      count: c.contradicted,
      label: 'contradicted',
      meaning: 'The engine says it is wrong',
      tone: 'text-error',
    },
    {
      count: c.supported,
      label: 'supported',
      meaning: 'Backed by evidence the engine delivered; not independently checked',
      tone: '',
    },
    {
      count: c.unsupported,
      label: 'unsupported',
      meaning: 'No delivered evidence backs it',
      tone: 'text-warning',
    },
    {
      count: c.unverifiable,
      label: 'unverifiable',
      meaning: 'The engine cannot decide it (scope or access)',
      tone: 'text-warning',
    },
  ].filter((p) => p.count > 0);
}

function claimText(c: ClaimVerdictDto['claim']): string {
  if (c.kind === 'note') return c.text;
  if (c.kind === 'location') return `${c.repo}:${c.path}:${c.line} "${c.contains}"`;
  return `${c.consumer} ${c.polarity === 'present' ? '→' : '↛'} ${c.provider}`;
}

/** Lo que el modelo afirmó y lo que el motor dijo de cada afirmación. */
function Verdicts({ verdicts }: { verdicts: ClaimVerdictDto[] }): React.ReactElement {
  return (
    <details className="text-[11px]" data-testid="verdicts">
      <summary className="cursor-pointer text-muted hover:text-fg">Engine verdicts</summary>
      <ul className="mt-1.5 space-y-1.5">
        {verdicts.map((v) => (
          <li key={`${claimText(v.claim)}|${v.verdict}`}>
            <span className="font-mono">{claimText(v.claim)}</span>{' '}
            <span className={`font-medium ${VERDICT_STYLE[v.verdict]}`}>{v.verdict}</span>
            {v.engine && v.engine.uses > 0 && (
              <span className="text-muted">
                {' '}
                · {v.engine.uses} use{v.engine.uses === 1 ? '' : 's'}
              </span>
            )}
            <div className="text-muted">{v.reason}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Mientras el modelo lee código y el motor comprueba cada afirmación pasan de decenas de
 * segundos a un par de minutos: sin señal de vida parece colgado. Se muestra QUÉ está
 * haciendo (cada lectura al motor, en vivo) y cuánto lleva.
 */
function Investigating({ progress }: { progress: ProgressEventDto[] }): React.ReactElement {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const tools = progress.filter(
    (e): e is Extract<ProgressEventDto, { type: 'tool' }> => e.type === 'tool',
  );
  const last = progress[progress.length - 1];
  const rounds = progress.filter((e) => e.type === 'round');
  const lastRound = rounds[rounds.length - 1] as
    | Extract<ProgressEventDto, { type: 'round' }>
    | undefined;
  const wrap = progress.find((e) => e.type === 'wrapup');
  const doing =
    last?.type === 'verify'
      ? `Checking ${last.claims} claim${last.claims === 1 ? '' : 's'} against the code…`
      : last?.type === 'round' && last.forced
        ? 'Writing the answer…'
        : last?.type === 'round'
          ? tools.length === 0
            ? 'Planning the first read…'
            : 'Deciding the next step…'
          : last?.type === 'wrapup'
            ? 'Wrapping up…'
            : tools.length > 0
              ? 'Reading the result…'
              : 'Starting…';
  return (
    <div className="space-y-1 text-sm text-muted" data-testid="investigating">
      <div className="flex items-center gap-2">
        <div className="animate-pulse w-2 h-2 rounded-full bg-accent" />
        <span>
          Investigating… <span className="tabular-nums">{secs} s</span>
        </span>
        {lastRound && (
          <span className="ml-auto text-[11px] tabular-nums" data-testid="progress-count">
            {lastRound.toolCallsUsed} of {lastRound.maxToolCalls} reads
          </span>
        )}
      </div>
      <p className="pl-4 text-[11px]" data-testid="progress-doing">
        {doing}
      </p>
      {tools.length > 0 && (
        <ul className="space-y-0.5 pl-4 text-[11px]" data-testid="progress-steps">
          {tools.slice(-5).map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: la lista sólo crece por el final
            <li key={i} className={t.ok ? '' : 'text-warning'}>
              <span aria-hidden="true">{t.ok ? '✓' : '·'}</span>{' '}
              <span className="font-mono">{t.tool}</span>
              {t.summary ? <span> · {t.summary}</span> : null}
              {!t.ok && t.note ? <span> (refused: {t.note.replace(/_/g, ' ')})</span> : null}
            </li>
          ))}
        </ul>
      )}
      {wrap && (
        <p className="pl-4 text-[11px] text-warning" data-testid="progress-wrapup">
          {wrap.type === 'wrapup' && wrap.reason === 'locations'
            ? 'Asking for the code locations to be checkable…'
            : 'Enough reading: asking for the answer now.'}
        </p>
      )}
      {secs > 45 && (
        <p className="pl-4 text-[11px]">A thorough answer can take a couple of minutes.</p>
      )}
    </div>
  );
}
