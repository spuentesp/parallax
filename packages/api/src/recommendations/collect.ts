import { createHash } from 'node:crypto';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { LooseEnd } from '../loose-ends/types.js';
import { parseBindingEntry } from './binding-entry.js';
import type { BindingDecl, Recommendation } from './types.js';

const MAX_ITEMS = 60;
const MAX_CANDIDATES = 8;
const CONCURRENCY = 6;

/** Un cabo suelto visto por el servicio de loose-ends: con el veredicto, si lo hay. */
export type LooseEndInput = LooseEnd & { assessment?: { category?: string } | null };

/** Categorías que no merecen una declaración: no son una llamada real al producto. */
const NOT_WORTH_DECLARING = new Set(['test_or_tooling', 'not_a_call', 'external_call']);

export interface ValidCandidate {
  ref: { key: string; service: string };
  declaration: BindingDecl;
  templateMatch: string;
}

/** Sitios con varios candidatos que el motor acepta: no hay una única respuesta. */
export interface MultiChoice {
  item: LooseEndInput;
  valid: ValidCandidate[];
}

/**
 * `http:ANY /`, `http:POST /`…: una ruta raíz comodín. El motor la acepta para casi
 * cualquier llamada con ese método, así que su "valid" dice muy poco (visto: llamadas a
 * un portal EXTERNO que casaban con `ANY /` de dos servicios internos).
 */
export const isCatchAllRoute = (key: string): boolean => /^http:[A-Z*]+ \/$/.test(key);

const idOf = (...parts: string[]): string =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

async function mapPool<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export function bindingRecommendation(
  item: LooseEndInput,
  c: ValidCandidate,
  alternatives: ValidCandidate[],
  checked: number,
): Recommendation {
  const where = `${item.repo}:${item.path}${item.line ? `:${item.line}` : ''}`;
  const partial = item.candidateCount > checked;
  return {
    id: idOf('binding', item.repo, item.path, String(item.line), c.ref.service, c.ref.key),
    kind: 'binding',
    title: `${where} → ${c.ref.service} ${c.ref.key}`,
    site: { repo: item.repo, path: item.path, line: item.line },
    declaration: c.declaration,
    basis: 'engine_verified',
    basisDetail:
      `check_binding accepts it (template ${c.templateMatch})` +
      (partial
        ? `; ${checked} of ${item.candidateCount} candidates were checked`
        : alternatives.length === 0
          ? '; the only candidate that passes'
          : ''),
    caution: isCatchAllRoute(c.ref.key)
      ? `${c.ref.key} is a catch-all route: the engine accepts it for almost any call, so check that the code really calls ${c.ref.service} before adding it`
      : null,
    alternatives: alternatives.map((a) => ({ key: a.ref.key, service: a.ref.service })),
    rationale: null,
    modelPicked: false,
  };
}

/**
 * Cabos sueltos sin resolver cuyos candidatos el motor valida (`check_binding`, puro).
 * Sólo se recomienda lo que el motor ACEPTA, y sólo si es unívoco: si varios
 * candidatos pasan, se devuelven aparte para que alguien (o el modelo, entre esos
 * mismos) elija.
 */
export async function collectBindings(
  adapter: Pick<LainAdapter, 'checkBinding'>,
  items: readonly LooseEndInput[],
): Promise<{
  recommendations: Recommendation[];
  multi: MultiChoice[];
  skipped: Map<string, number>;
}> {
  const skipped = new Map<string, number>();
  const skip = (reason: string, n = 1) => skipped.set(reason, (skipped.get(reason) ?? 0) + n);

  const eligible: LooseEndInput[] = [];
  for (const i of items) {
    if (i.kind !== 'unresolved') continue;
    if (i.assessment?.category && NOT_WORTH_DECLARING.has(i.assessment.category)) {
      skip('test, tooling or not a real call');
    } else if (!i.consumerId || !i.candidateRefs?.length) {
      skip('the engine offered no candidate endpoint');
    } else eligible.push(i);
  }
  // Los de menos candidatos primero: son los que más probablemente tienen respuesta.
  eligible.sort((a, b) => a.candidateCount - b.candidateCount || a.path.localeCompare(b.path));
  const work = eligible.slice(0, MAX_ITEMS);
  if (eligible.length > work.length)
    skip('not examined (limit per run)', eligible.length - work.length);

  const recommendations: Recommendation[] = [];
  const multi: MultiChoice[] = [];
  const seen = new Set<string>();

  await mapPool(work, CONCURRENCY, async (item) => {
    const candidates = (item.candidateRefs ?? []).slice(0, MAX_CANDIDATES);
    const valid: ValidCandidate[] = [];
    let unreadable = false;
    let failed = false;
    for (const ref of candidates) {
      try {
        const r = await adapter.checkBinding({
          snapshot: 'live',
          consumer: item.consumerId as string,
          endpoint: { key: ref.key, service: ref.service },
        });
        if (!r.valid) continue;
        const declaration = r.bindings_entry ? parseBindingEntry(r.bindings_entry) : null;
        if (!declaration) {
          unreadable = true;
          continue;
        }
        valid.push({ ref, declaration, templateMatch: String(r.template_match) });
      } catch {
        failed = true;
      }
    }
    if (valid.length === 0) {
      skip(
        failed
          ? 'the engine could not be asked'
          : unreadable
            ? 'the engine entry was not understood'
            : 'the engine rejects every candidate',
      );
      return;
    }
    if (valid.length > 1) {
      multi.push({ item, valid });
      return;
    }
    const [only] = valid as [ValidCandidate];
    const rec = bindingRecommendation(item, only, [], candidates.length);
    if (!seen.has(rec.id)) {
      seen.add(rec.id);
      recommendations.push(rec);
    }
  });
  return { recommendations, multi, skipped };
}
