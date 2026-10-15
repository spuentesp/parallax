import fc from 'fast-check';

/** Cadenas arbitrarias; se usa para textos donde sólo importa la estructura. */
export const arbText = fc.string({ maxLength: 60 });

/** Nombres de repo estilo LAIN: [a-z0-9-], 1..16 chars. */
export const arbRepoName = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 16,
  })
  .map((chars) => chars.join(''));

/** SHAs hex de 7..40 chars (v4 de fast-check ya no trae `hexaString`). */
export const arbSha = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 7, maxLength: 40 })
  .map((chars) => chars.join(''));

/** Valores JSON seguros (sin undefined), para canonicalJson. */
export const arbJson = fc.jsonValue();

/**
 * Parámetros reproducibles para todas las propiedades: FC_RUNS ajusta el
 * número de corridas y FC_SEED permite reproducir un contraejemplo concreto
 * (fast-check imprime el seed en cada fallo).
 */
export function fcDefaults(extra: { numRuns?: number } = {}): {
  numRuns: number;
  endOnFailure: boolean;
  seed?: number;
} {
  const base = { numRuns: extra.numRuns ?? Number(process.env.FC_RUNS ?? 100), endOnFailure: true };
  const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
  return seed === undefined ? base : { ...base, seed };
}
