// MatrixLens — la misma red de dependencias que el grafo, en lente de matriz
// (referencia de diseño "dependency matrix"): filas = consumidores, columnas =
// proveedores, la celda grande muestra los call-sites agregados con procedencia
// en el color (continuo/determinista, ámbar/inferido) y una columna extra de
// llamadas sin resolver. La tabla ocupa todo el ancho (table-fixed) para que con
// pocos servicios las celdas sean grandes y legibles. Nivel Repos (bloques
// diagonales = dentro de un repo) o Services. Clic en una celda abre el panel
// del par con sus contratos y las acciones de la referencia: preguntar al
// asistente, abrir contratos, mostrar como grafo.

import type { MatrixData, MatrixLink, MatrixService } from '@parallax/shared/org-map';
import type * as React from 'react';
import { useMemo, useState } from 'react';
import { useLooseEnds, useOrgMatrix } from '../api/hooks.js';
import { EdgeSwatch } from './icons.js';

type Level = 'repos' | 'services';

interface AxisItem {
  id: string;
  label: string;
  group: string | null;
}

interface ViewCell {
  count: number;
  provenance: 'deterministic' | 'inferred';
  confidence: number;
  links: MatrixLink[];
  /** Servicios bajo la celda (para "show as graph"). */
  consumerId: string;
  providerId: string;
}

/** Intensidad del chip según call-sites, en la escala de la referencia:
 *  1 → 0.28 … 40+ → 1.0 (logarítmica). */
function cellAlpha(count: number): number {
  return 0.28 + 0.72 * Math.min(1, Math.log2(Math.max(1, count)) / Math.log2(40));
}

/** Opacidad de los swatches de la leyenda (los mismos pasos que las celdas). */
const LEGEND_COUNTS = [1, 2, 6, 16, 40] as const;

type Order = 'cluster' | 'name';

// Los tokens hay que resolverlos a hex en cada uso: "var(--x)47" no es un
// color válido (el fondo quedaba transparente) y en la carga del módulo el
// tema todavía no está aplicado.
function tokenHex(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.startsWith('#') ? v : fallback;
}

/** Color de procedencia con opacidad alpha (0-1) como hex de 8 dígitos. */
function provBg(p: 'deterministic' | 'inferred', alpha: number): string {
  const base = tokenHex(
    p === 'deterministic' ? '--color-deterministic' : '--color-inferred',
    p === 'deterministic' ? '#8b96a5' : '#f59e0b',
  );
  return `${base}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

export function MatrixLens({
  workspaceId,
  onSelect,
  onFocus,
  onAsk,
  onOpenContracts,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  /** Abre el asistente con la pregunta ya planteada (?ask=). */
  onAsk?: (question: string) => void;
  /** Navega a la pantalla de contratos del workspace. */
  onOpenContracts?: () => void;
}): React.ReactElement {
  const q = useOrgMatrix(workspaceId);
  const loose = useLooseEnds(workspaceId);
  const [level, setLevel] = useState<Level>('services');
  const [order, setOrder] = useState<Order>('cluster');
  const [pair, setPair] = useState<{ consumer: string; provider: string } | null>(null);
  const [askText, setAskText] = useState('');

  const matrix = q.data?.matrix ?? null;

  // Llamadas sin resolver por consumidor (columna "unresolved").
  const unresolved = useMemo(() => {
    const byService = new Map<string, number>();
    const byRepo = new Map<string, number>();
    const servicesWithUnresolved = new Set<string>();
    for (const item of loose.data?.items ?? []) {
      if (item.kind !== 'unresolved') continue;
      const svc = item.detail?.targetService;
      if (svc) {
        byService.set(svc, (byService.get(svc) ?? 0) + 1);
        servicesWithUnresolved.add(svc);
      }
      byRepo.set(item.repo, (byRepo.get(item.repo) ?? 0) + 1);
    }
    return { byService, byRepo, serviceCount: servicesWithUnresolved.size };
  }, [loose.data?.items]);

  const view = useMemo(() => buildView(matrix, level, order), [matrix, level, order]);

  const selected = useMemo(() => {
    if (!pair || !view) return null;
    return (
      view.cells.get(`${pair.consumer}->${pair.provider}`) ?? {
        count: 0,
        det: 0,
        inf: 0,
        provenance: 'deterministic' as const,
        confidence: 1,
        links: [],
        consumerId: pair.consumer,
        providerId: pair.provider,
      }
    );
  }, [pair, view]);

  if (q.isPending && !matrix) {
    return <div className="p-6 text-sm text-muted">Loading matrix…</div>;
  }
  if (!matrix) {
    return (
      <div className="p-6 text-sm text-muted" data-testid="matrix-empty">
        Matrix unavailable:{' '}
        {q.data?.meta?.source !== 'lain' ? 'no LAIN server connected' : 'graph error'}.
      </div>
    );
  }
  if (!view || view.rows.length === 0) {
    return (
      <div className="p-6 text-sm text-muted" data-testid="matrix-empty">
        No services in this workspace yet.
      </div>
    );
  }

  const stats = matrixStats(
    matrix,
    (loose.data?.items ?? []).filter((i) => i.kind === 'unresolved').length,
    unresolved.serviceCount,
  );
  const mostDepended = [...matrix.services]
    .map((s) => ({
      ...s,
      consumers: matrix.cells.filter((c) => c.provider === s.id).length,
    }))
    .filter((s) => s.consumers > 0)
    .sort((a, b) => b.consumers - a.consumers || a.label.localeCompare(b.label))
    .slice(0, 3);

  return (
    <div className="flex h-full min-h-0" data-testid="matrix-lens">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="text-xs text-muted max-w-xl">
              Rows are consumers, columns are providers. Each cell is the number of call sites
              between them; blocks on the diagonal are inside one repo.
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div
                role="group"
                aria-label="Order"
                className="flex items-center gap-1.5 text-xs text-muted"
              >
                <span>Order</span>
                {(['cluster', 'name'] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={order === o}
                    onClick={() => setOrder(o)}
                    className={`rounded-full border px-2.5 py-1 capitalize ${
                      order === o
                        ? 'border-accent bg-accent-soft text-accent font-medium'
                        : 'border-border text-muted hover:bg-bg'
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-xs">
                {(['repos', 'services'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={level === l}
                    onClick={() => {
                      setLevel(l);
                      setPair(null);
                    }}
                    className={`rounded-md px-2 py-1 capitalize ${
                      level === l
                        ? 'bg-accent-soft text-accent font-medium'
                        : 'text-muted hover:bg-bg'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full overflow-auto rounded-xl border border-border">
            <table className="w-full table-fixed border-collapse text-sm" data-testid="matrix-grid">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-[10rem] border-b border-r border-border bg-surface px-3 py-2 text-right align-bottom" />
                  {view.cols.map((c) => (
                    <th
                      key={c.id}
                      className="h-32 border-b border-border px-2 py-2 align-bottom"
                      title={c.group ?? c.label}
                    >
                      <span
                        className="mx-auto block max-h-28 truncate font-mono text-xs font-medium text-fg"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                      >
                        {c.label}
                      </span>
                    </th>
                  ))}
                  <th className="h-32 w-16 border-b border-l border-border px-2 py-2 align-bottom">
                    <span
                      className="mx-auto block max-h-28 font-medium text-error"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      unresolved
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.id}>
                    <th
                      className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 text-right"
                      title={row.group ?? row.label}
                    >
                      <button
                        type="button"
                        className="block w-full truncate font-mono text-xs text-fg hover:text-accent"
                        onClick={() => onSelect(row.id)}
                      >
                        {row.label}
                      </button>
                    </th>
                    {view.cols.map((col) => {
                      const cell = view.cells.get(`${row.id}->${col.id}`);
                      const sameGroup = row.group !== null && row.group === col.group;
                      const alpha = cell ? cellAlpha(cell.count) : 0;
                      return (
                        <td
                          key={col.id}
                          role={cell ? 'button' : undefined}
                          tabIndex={cell ? 0 : undefined}
                          onKeyDown={
                            cell
                              ? (ev) => {
                                  if (ev.key === 'Enter' || ev.key === ' ') {
                                    ev.preventDefault();
                                    setPair({ consumer: row.id, provider: col.id });
                                  }
                                }
                              : undefined
                          }
                          className={`h-14 border-b border-border px-2 text-center ${
                            cell ? 'cursor-pointer' : ''
                          }`}
                          style={{
                            // Toda celda lleva fondo como en la referencia: la
                            // diagonal (dentro de un repo) algo más clara.
                            backgroundColor: sameGroup
                              ? 'var(--color-surface-2)'
                              : 'color-mix(in srgb, var(--color-surface-2) 45%, var(--color-bg))',
                          }}
                          onClick={() => cell && setPair({ consumer: row.id, provider: col.id })}
                          title={
                            cell
                              ? `${row.label} → ${col.label} · ${cell.count} call sites · ${cell.provenance}${cell.provenance === 'inferred' ? ` ${cell.confidence.toFixed(1)}` : ''}`
                              : undefined
                          }
                          data-testid={`matrix-cell-${row.id}-${col.id}`}
                        >
                          {cell && (
                            <span
                              className="inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 tabular-nums text-sm font-semibold"
                              style={{
                                backgroundColor: provBg(cell.provenance, alpha),
                                color: alpha > 0.5 ? 'var(--color-bg)' : 'var(--color-fg)',
                                // Inferido: borde punteado ámbar sobre el chip,
                                // como los cuadrados de la referencia.
                                ...(cell.provenance === 'inferred'
                                  ? {
                                      outline: '1.5px dashed var(--color-inferred)',
                                      outlineOffset: -1.5,
                                    }
                                  : {}),
                              }}
                            >
                              {cell.count}
                              {cell.provenance === 'inferred'
                                ? ` · ${cell.confidence.toFixed(1)}`
                                : ''}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="h-14 border-b border-l border-border px-2 text-center">
                      {(() => {
                        const n =
                          level === 'services'
                            ? (unresolved.byService.get(row.label) ?? 0)
                            : (unresolved.byRepo.get(row.group ?? '') ?? 0);
                        return n > 0 ? (
                          <span className="tabular-nums text-sm font-semibold text-error">{n}</span>
                        ) : null;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              1
              {LEGEND_COUNTS.map((c) => (
                <span
                  key={c}
                  className="inline-block h-3.5 w-5 rounded-sm"
                  style={{
                    backgroundColor: provBg('deterministic', cellAlpha(c)),
                  }}
                />
              ))}
              40+ call sites
            </span>
            <span className="inline-flex items-center gap-1.5">
              <EdgeSwatch provenance="deterministic" width={22} /> Proven
            </span>
            <span className="inline-flex items-center gap-1.5">
              <EdgeSwatch provenance="inferred" width={22} /> Inferred (N·c = count · confidence)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-error/70" /> Unresolved
            </span>
          </div>
        </div>

        {onAsk && (
          <form
            className="flex items-center gap-2 border-t border-border bg-surface px-6 py-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const text = askText.trim();
              if (!text) return;
              onAsk(text);
              setAskText('');
            }}
          >
            <input
              type="text"
              value={askText}
              onChange={(ev) => setAskText(ev.target.value)}
              placeholder="Ask about this matrix, for example which pairs form a cycle"
              aria-label="Ask about this matrix"
              data-testid="matrix-ask-input"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50"
              disabled={!askText.trim()}
            >
              Ask
            </button>
          </form>
        )}
      </div>

      <aside
        className="w-[21rem] shrink-0 overflow-y-auto border-l border-border bg-surface p-5 space-y-5"
        aria-label="Selected pair"
        data-testid="matrix-pair-panel"
      >
        {pair && view && selected ? (
          <PairPanel
            row={view.rows.find((r) => r.id === pair.consumer)}
            col={view.cols.find((c) => c.id === pair.provider)}
            cell={selected}
            onSelect={onSelect}
            onFocus={onFocus}
            {...(onAsk ? { onAsk } : {})}
            {...(onOpenContracts ? { onOpenContracts } : {})}
            onClose={() => setPair(null)}
          />
        ) : (
          <>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
              What the matrix shows
            </h3>
            <ul className="space-y-1.5 text-[13px] text-muted">
              <li>
                <b className="text-fg tabular-nums">{stats.pairs}</b>{' '}
                {level === 'repos' ? 'cross-repo pairs' : 'cross-service pairs'},{' '}
                <b className="text-fg tabular-nums">{stats.inferredPairs}</b> of all pairs inferred
              </li>
              <li>
                <b className="text-fg tabular-nums">{stats.twoWay}</b> two-way pairs
                {stats.twoWayExample ? (
                  <>
                    , e.g. <span className="font-mono text-xs">{stats.twoWayExample}</span>
                  </>
                ) : null}
              </li>
              <li>
                <b className="text-error tabular-nums">{stats.unresolved}</b> unresolved calls
                {stats.unresolvedServices > 0
                  ? ` in ${stats.unresolvedServices} service${stats.unresolvedServices === 1 ? '' : 's'}`
                  : ''}
              </li>
            </ul>
            {mostDepended.length > 0 && (
              <>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
                  Most depended on
                </h3>
                <ul className="space-y-1">
                  {mostDepended.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 border-t border-border pt-1.5 text-xs"
                    >
                      <button
                        type="button"
                        className="truncate font-mono font-medium text-fg hover:text-accent"
                        onClick={() => onSelect(s.id)}
                      >
                        {s.label}
                      </button>
                      <span className="shrink-0 text-muted tabular-nums">
                        {s.consumers} consumer{s.consumers === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-xs text-muted">
              Click a cell to see the pair through its contracts.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

function PairPanel({
  row,
  col,
  cell,
  onSelect,
  onFocus,
  onAsk,
  onOpenContracts,
  onClose,
}: {
  row: AxisItem | undefined;
  col: AxisItem | undefined;
  cell: ViewCell;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onAsk?: (question: string) => void;
  onOpenContracts?: () => void;
  onClose: () => void;
}): React.ReactElement {
  const consumerLabel = row?.label ?? cell.consumerId;
  const providerLabel = col?.label ?? cell.providerId;
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Selected pair</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-fg text-xs"
            aria-label="Close pair panel"
          >
            ✕
          </button>
        </div>
        <p className="mt-1.5 text-sm font-semibold break-words">
          <button
            type="button"
            className="hover:text-accent"
            onClick={() => onSelect(cell.consumerId)}
          >
            {consumerLabel}
          </button>
          <span className="text-muted font-normal"> → </span>
          <button
            type="button"
            className="hover:text-accent"
            onClick={() => onSelect(cell.providerId)}
          >
            {providerLabel}
          </button>
        </p>
        <p className="mt-1 text-xs text-muted flex items-center gap-1.5">
          {row?.group && col?.group && row.group !== col.group
            ? `${row.group} → ${col.group} · `
            : ''}
          <b className="text-fg tabular-nums">{cell.count}</b> call sites ·{' '}
          <EdgeSwatch provenance={cell.provenance} width={20} />{' '}
          {cell.provenance === 'inferred' ? `inferred ${cell.confidence.toFixed(1)}` : 'proven'}
        </p>
      </div>

      <div>
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">
          Through contracts
        </h4>
        {cell.links.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No endpoint detail for this pair.</p>
        ) : (
          <ul className="mt-1">
            {cell.links.map((l) => (
              <li key={l.endpointId} className="border-t border-border">
                <button
                  type="button"
                  onClick={() => onSelect(l.endpointId)}
                  className="flex w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-bg"
                >
                  <span className="w-11 shrink-0 text-[10px] uppercase text-muted">
                    {l.endpointLabel.split(' ')[0]?.replace(':', '') ?? 'call'}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs"
                    title={l.endpointLabel}
                  >
                    {l.endpointLabel}
                  </span>
                  <span className="tabular-nums text-xs text-muted">×{l.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onAsk && (
          <button
            type="button"
            onClick={() =>
              onAsk(
                `Why does ${consumerLabel} depend on ${providerLabel}? Show the ${cell.count} call sites through their contracts and who else calls them.`,
              )
            }
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg"
          >
            Ask about this pair
          </button>
        )}
        {onOpenContracts && (
          <button
            type="button"
            onClick={onOpenContracts}
            className="rounded-lg border border-border px-3.5 py-2 text-xs hover:bg-bg"
          >
            Open contracts
          </button>
        )}
        <button
          type="button"
          onClick={() => onFocus(cell.consumerId)}
          className="rounded-lg border border-border px-3.5 py-2 text-xs hover:bg-bg"
        >
          Show as graph
        </button>
      </div>
    </div>
  );
}

/** Celda agregada en la matriz; en nivel repos acumula det/inf para derivar la procedencia. */
type AccCell = ViewCell & { det: number; inf: number };

/** Agrupa la matriz al nivel pedido. Orden "cluster": por repo y, dentro,
 *  por grado de dependencia (más conectado primero); "name": alfabético. */
function buildView(
  matrix: MatrixData | null,
  level: Level,
  order: Order = 'cluster',
): { rows: AxisItem[]; cols: AxisItem[]; cells: Map<string, AccCell> } | null {
  if (!matrix) return null;
  if (level === 'services') {
    const degree = new Map<string, number>();
    for (const c of matrix.cells) {
      degree.set(c.consumer, (degree.get(c.consumer) ?? 0) + c.count);
      degree.set(c.provider, (degree.get(c.provider) ?? 0) + c.count);
    }
    const rows = matrix.services
      .map((s) => ({ id: s.id, label: s.label, group: s.repoLabel }))
      .sort((a, b) => {
        const byGroup = (a.group ?? '~').localeCompare(b.group ?? '~');
        if (byGroup !== 0) return byGroup;
        if (order === 'cluster') {
          const byDegree = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
          if (byDegree !== 0) return byDegree;
        }
        return a.label.localeCompare(b.label);
      });
    const cols = rows.map((r) => ({ ...r }));
    const cells = new Map<string, AccCell>();
    for (const c of matrix.cells) {
      cells.set(`${c.consumer}->${c.provider}`, {
        count: c.count,
        det: c.deterministicCount,
        inf: c.inferredCount,
        provenance: c.provenance,
        confidence: c.confidence,
        links: c.links,
        consumerId: c.consumer,
        providerId: c.provider,
      });
    }
    return { rows, cols, cells };
  }
  // Nivel repos: agrega servicios por repo.
  const repoOfService = new Map(matrix.services.map((s) => [s.id, s]));
  const byRepo = new Map<string, MatrixService[]>();
  for (const s of matrix.services) {
    const key = s.repoId ?? s.label;
    const list = byRepo.get(key) ?? [];
    list.push(s);
    byRepo.set(key, list);
  }
  const repoDegree = new Map<string, number>();
  for (const c of matrix.cells) {
    const cs = repoOfService.get(c.consumer);
    const ps = repoOfService.get(c.provider);
    const cr = cs?.repoId ?? cs?.label ?? c.consumer;
    const pr = ps?.repoId ?? ps?.label ?? c.provider;
    repoDegree.set(cr, (repoDegree.get(cr) ?? 0) + c.count);
    repoDegree.set(pr, (repoDegree.get(pr) ?? 0) + c.count);
  }
  const repos = [...byRepo.entries()]
    .map(([id, list]) => ({
      id,
      label: list[0]?.repoLabel ?? id,
      group: null as string | null,
    }))
    .sort((a, b) => {
      if (order === 'cluster') {
        const byDegree = (repoDegree.get(b.id) ?? 0) - (repoDegree.get(a.id) ?? 0);
        if (byDegree !== 0) return byDegree;
      }
      return a.label.localeCompare(b.label);
    });
  const cells = new Map<string, AccCell>();
  for (const c of matrix.cells) {
    const cs = repoOfService.get(c.consumer);
    const ps = repoOfService.get(c.provider);
    const cr = cs?.repoId ?? cs?.label ?? c.consumer;
    const pr = ps?.repoId ?? ps?.label ?? c.provider;
    const key = `${cr}->${pr}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        count: 0,
        det: 0,
        inf: 0,
        provenance: 'deterministic',
        confidence: 1,
        links: [],
        consumerId: c.consumer,
        providerId: c.provider,
      };
      cells.set(key, cell);
    }
    cell.count += c.count;
    cell.det += c.deterministicCount;
    cell.inf += c.inferredCount;
    cell.provenance = cell.det > 0 ? 'deterministic' : 'inferred';
    if (c.provenance === 'inferred') cell.confidence = Math.min(cell.confidence, c.confidence);
    for (const l of c.links) {
      const at = cell.links.findIndex((x) => x.endpointId === l.endpointId);
      if (at >= 0) {
        const ex = cell.links[at] as MatrixLink;
        ex.count += l.count;
      } else {
        cell.links.push({ ...l });
      }
    }
    cell.links.sort((a, b) => b.count - a.count);
    if (cell.links.length > 12) cell.links.length = 12;
  }
  return { rows: repos, cols: repos.map((r) => ({ ...r })), cells };
}

function matrixStats(
  matrix: MatrixData,
  unresolvedTotal: number,
  unresolvedServices: number,
): {
  pairs: number;
  inferredPairs: number;
  twoWay: number;
  twoWayExample: string | null;
  unresolved: number;
  unresolvedServices: number;
} {
  // Pares de ida y vuelta: cuenta cada par no ordenado una vez.
  const labelOf = (id: string) => matrix.services.find((s) => s.id === id)?.label ?? id;
  const twoWayPairs = matrix.cells.filter(
    (c) =>
      c.consumer !== c.provider &&
      c.consumer < c.provider &&
      matrix.cells.some((o) => o.consumer === c.provider && o.provider === c.consumer),
  );
  const first = twoWayPairs[0];
  return {
    pairs: matrix.cells.length,
    inferredPairs: matrix.cells.filter((c) => c.provenance === 'inferred').length,
    twoWay: twoWayPairs.length,
    twoWayExample: first ? `${labelOf(first.consumer)} ↔ ${labelOf(first.provider)}` : null,
    unresolved: unresolvedTotal,
    unresolvedServices,
  };
}
