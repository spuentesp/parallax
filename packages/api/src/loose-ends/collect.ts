import { createHash } from 'node:crypto';
import type { LainView } from '@parallax/shared/lain';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { LooseEnd } from './types.js';

const PAGE = 200;
const MAX_PAGES = 10;
const MAX_CANDIDATES_SHOWN = 3;

function keyOf(parts: Array<string | number | null | undefined>): string {
  return createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 16);
}

interface Anchor {
  repo?: string;
  path?: string;
  line?: number;
}

const anchorOf = (v: unknown): Anchor | undefined =>
  v && typeof v === 'object' ? (v as Anchor) : undefined;

/**
 * Reúne los cabos sueltos del motor:
 *  - llamadas SIN RESOLVER (list_unresolved, todas las páginas);
 *  - usos atados sólo por HEURÍSTICA (relaciones inferidas), con su sitio.
 * Nada se inventa: cada entrada es un hecho del motor con su ancla de código.
 */
export async function collectLooseEnds(
  adapter: LainAdapter,
  snapshot: LainView = 'live',
): Promise<LooseEnd[]> {
  const out = new Map<string, LooseEnd>();

  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await adapter.listUnresolved({
      snapshot,
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
    })) as unknown as { items?: Array<Record<string, unknown>>; cursor?: string | null };
    for (const it of res.items ?? []) {
      const at = anchorOf(it.consumer);
      if (!at?.path || !at.repo) continue;
      const candidates = Array.isArray(it.candidates)
        ? (it.candidates as Array<{ endpoint?: { key?: string } }>)
            .map((c) => c.endpoint?.key)
            .filter((k): k is string => typeof k === 'string')
        : [];
      const urlExpr = typeof it.url_expr === 'string' ? it.url_expr : undefined;
      const e: LooseEnd = {
        key: keyOf(['unresolved', at.repo, at.path, at.line, String(it.reason ?? ''), urlExpr]),
        kind: 'unresolved',
        repo: at.repo,
        path: at.path,
        line: at.line ?? null,
        reason: String(it.reason ?? 'unknown'),
        detail: {
          ...(typeof it.method === 'string' ? { method: it.method } : {}),
          ...(typeof it.host === 'string' ? { host: it.host } : {}),
          ...(typeof it.template === 'string' ? { template: it.template } : {}),
          ...(urlExpr ? { urlExpr } : {}),
          ...(typeof it.target_service === 'string' ? { targetService: it.target_service } : {}),
        },
        candidates: candidates.slice(0, MAX_CANDIDATES_SHOWN),
        candidateCount: candidates.length,
      };
      out.set(e.key, e);
    }
    cursor = res.cursor ?? undefined;
    if (!cursor) break;
  }

  const services = await adapter.listServices({ snapshot });
  for (const s of services.items) {
    const detail = await adapter.getService({ snapshot, service: s.service });
    for (const c of detail.consumers) {
      for (const u of c.uses) {
        if (u.binding?.kind !== 'heuristic') continue;
        const at = anchorOf(u.caller) ?? anchorOf(u.site);
        if (!at?.path || !at.repo) continue;
        const e: LooseEnd = {
          key: keyOf(['inferred', at.repo, at.path, at.line, u.endpoint?.key, u.binding.detector]),
          kind: 'inferred',
          repo: at.repo,
          path: at.path,
          line: at.line ?? null,
          reason: String(
            (u.binding as { detector?: string }).detector ?? u.binding.source ?? 'heuristic',
          ),
          detail: {
            targetService: u.endpoint?.service ?? s.service,
            ...(u.endpoint?.key ? { endpoint: u.endpoint.key } : {}),
            confidence: u.binding.confidence,
          },
          candidates: [],
          candidateCount: 0,
        };
        out.set(e.key, e);
      }
    }
  }
  return [...out.values()];
}
