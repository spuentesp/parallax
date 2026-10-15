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
