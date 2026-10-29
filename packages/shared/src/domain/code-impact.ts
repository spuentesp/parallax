import { z } from 'zod';

// Impacto de CÓDIGO de un PR: qué símbolos toca el cambio y a cuánto alcanzan, según el índice de
// código del motor (LAIN). Complementa al diff de CONTRATOS (APIs entre servicios): un PR que sólo
// cambia código interno no tiene hallazgos de contrato y aun así puede tocar mucho.
//
// El motor indexa el código tal como estaba: el alcance es el de la rama BASE. Los símbolos nuevos
// que añade el PR no existen en el índice y se cuentan aparte, sin inventarles dependientes.

export const CodeRiskSchema = z.enum(['low', 'medium', 'high', 'unknown']);
export type CodeRisk = z.infer<typeof CodeRiskSchema>;

export const ImpactedSymbolSchema = z.object({
  name: z.string(),
  kind: z.string(),
  repo: z.string(),
  path: z.string(),
  line: z.number(),
  /** `edited`: el PR cambia su cuerpo; `removed`: el PR borra el archivo que lo define. */
  change: z.enum(['edited', 'removed']),
  /** Llamadores directos y alcance transitivo; null cuando el motor no lo dijo. */
  direct: z.number().nullable(),
  transitive: z.number().nullable(),
  risk: CodeRiskSchema,
  /** Ninguna prueba llega al símbolo (null = no se supo). */
  untested: z.boolean().nullable(),
  dependents: z.array(z.object({ name: z.string(), path: z.string() })),
  /** Federated impact returns leaf paths, not a count of all transitive callers. */
  crossRepo: z
    .object({
      repositories: z.array(z.object({ repo: z.string(), leaves: z.array(z.string()) })),
      truncated: z.boolean(),
    })
    .nullable()
    .optional(),
  crossRepoNote: z.string().optional(),
  /** Por qué no hay medida (p. ej. el símbolo no está en el índice). */
  note: z.string().optional(),
});
export type ImpactedSymbol = z.infer<typeof ImpactedSymbolSchema>;

export const CodeImpactSchema = z.object({
  repo: z.string(),
  /** Qué commit tiene indexado el motor frente al que parte el PR. */
  index: z.object({
    commit: z.string().nullable(),
    matchesBase: z.boolean().nullable(),
  }),
  filesChanged: z.number(),
  filesAnalyzed: z.number(),
  symbols: z.array(ImpactedSymbolSchema),
  /** Definiciones que el PR añade: no están en el índice, no tienen dependientes aún. */
  newDefinitions: z.number(),
  /** Archivos con cambios fuera de cualquier símbolo (imports, constantes). */
  moduleScopeFiles: z.array(z.string()),
  skipped: z.object({
    nonCode: z.number(),
    tests: z.number(),
    addedFiles: z.number(),
    noDiff: z.number(),
    overFileLimit: z.number(),
    overSymbolLimit: z.number(),
  }),
  /** Lo que limita la lectura. Informativo: no vuelve parcial el informe de contratos. */
  gaps: z.array(z.string()),
  highestRisk: CodeRiskSchema.nullable(),
});
export type CodeImpact = z.infer<typeof CodeImpactSchema>;
