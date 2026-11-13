import type { LainAdapter } from '../lain-adapter/types.js';
import { bindingRecommendation, collectBindings, type LooseEndInput } from './collect.js';
import { explainRecommendations, pickAmongValid, type RecommendModel } from './explain.js';
import type { Recommendation, RecommendationsDto } from './types.js';

export interface RecommendInput {
  adapter: Pick<LainAdapter, 'checkBinding' | 'getCodeSnippet'>;
  items: readonly LooseEndInput[];
  /** null = sin modelo configurado. */
  model: RecommendModel | null;
  /** false = hay modelo pero se agotó el cupo: sólo se devuelve lo que valida el motor. */
  modelAllowed: boolean;
}

/**
 * Recomendaciones para rellenar el contexto de remediación. El orden de confianza es
 * fijo: primero lo que el motor acepta sin ayuda; después lo que el modelo eligió
 * ENTRE candidatos que el motor ya aceptaba. Nada se aplica: el resultado es una propuesta que se revisa con
 * "Preview changes" (el motor la valida entera) antes de "Apply".
 */
export async function buildRecommendations(
  input: RecommendInput,
): Promise<Omit<RecommendationsDto, 'source' | 'error'>> {
  const skipped = new Map<string, number>();
  const add = (m: Map<string, number>) => {
    for (const [k, n] of m) skipped.set(k, (skipped.get(k) ?? 0) + n);
  };
  const model = input.modelAllowed ? input.model : null;
  let note: string | null = null;
  if (!input.model) {
    note =
      'No model is configured: these are only the proposals the engine checked, without explanations.';
  } else if (!input.modelAllowed) {
    note =
      'The assistant limit for this hour was reached: showing only what the engine checked, without explanations.';
  }

  const bindings = await collectBindings(input.adapter, input.items);
  add(bindings.skipped);
  const picked: Recommendation[] = [];
  if (bindings.multi.length > 0) {
    let picks = new Map<string, number>();
    if (model) {
      try {
        picks = await pickAmongValid(model, input.adapter, bindings.multi);
      } catch (e) {
        note = `The model could not be reached (${e instanceof Error ? e.message : 'error'}): showing only what the engine checked.`;
      }
    }
    let unresolved = 0;
    for (const m of bindings.multi) {
      const choice = picks.get(m.item.key);
      const chosen = choice === undefined ? undefined : m.valid[choice];
      if (!chosen) {
        unresolved++;
        continue;
      }
      const others = m.valid.filter((_, i) => i !== choice);
      const rec = bindingRecommendation(m.item, chosen, others, m.valid.length);
      picked.push({
        ...rec,
        modelPicked: true,
        basisDetail: `check_binding accepts it, and so do ${others.length} other candidate${others.length === 1 ? '' : 's'}; the assistant picked this one from the code`,
      });
    }
    if (unresolved > 0) skipped.set('several candidates pass and none could be chosen', unresolved);
  }

  const recommendations: Recommendation[] = [...bindings.recommendations, ...picked];

  if (model && recommendations.length > 0) {
    try {
      const text = await explainRecommendations(model, input.adapter, recommendations);
      for (const r of recommendations) r.rationale = text.get(r.id) ?? null;
    } catch (e) {
      note = `The model could not be reached (${e instanceof Error ? e.message : 'error'}): explanations omitted.`;
    }
  }

  return {
    recommendations,
    skipped: [...skipped]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    model: { used: model !== null && note === null, name: model?.name ?? null, note },
  };
}
