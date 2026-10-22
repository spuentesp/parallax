// Tipos del config advisor (§10 del diseño de Parallax): el advisor cierra
// huecos de configuración de LAIN con YAML validado y evidencia. No descubre
// la organización entera y no escribe internos de .lain — su única salida es
// configuración (repos.yaml) más la explicación que la sostiene.

/** Repo analizado: id tal como aparece en repos.yaml + ruta del checkout. */
export interface AdvisorRepoInput {
  readonly id: string;
  readonly root: string;
}

export type SignalKind =
  | 'graphql_operations'
  | 'fragment_only_document'
  | 'sdl_copy'
  | 'env_base_url'
  | 'wrapped_fetcher'
  | 'codegen_config'
  | 'gitignored_generated';

/**
 * Señal detectada en el checkout. `file` es relativa al root del repo (con
 * `/`). Las señales GraphQL llevan `derivedKey` = `graphql:<op>:<root field>`
 * — la llave que el motor usa en list_contracts y que une el documento con el
 * nodo consumidor.
 */
export interface AdvisorSignal {
  readonly kind: SignalKind;
  readonly repo: string;
  readonly file: string;
  readonly line?: number;
  readonly detail?: string;
  readonly derivedKey?: string;
  readonly operationType?: string;
  readonly operationName?: string;
  readonly rootField?: string;
  readonly fragments?: readonly string[];
  readonly envVar?: string;
}

export interface ServiceRef {
  readonly service: string;
  readonly repo: string;
}

// ---- correlación con el motor ------------------------------------------------

export interface UnresolvedConsumerRef {
  readonly id: string;
  readonly repo?: string;
  readonly path?: string;
  readonly line?: number;
}

export interface UnresolvedItem {
  readonly reason: string;
  readonly consumer: UnresolvedConsumerRef;
  readonly target_service?: string | null;
  readonly method?: string | null;
  readonly template?: string | null;
  readonly url_expr?: string | null;
}

export interface ContractProvider {
  readonly repo?: string;
  readonly path?: string;
  readonly line?: number;
  readonly id?: string;
}

export interface ContractItem {
  readonly endpoint: { readonly key: string; readonly service: string };
  readonly bound_consumers?: number;
  readonly providers?: readonly ContractProvider[];
}

/** Un grupo de proveedores para una llave: un servicio con sus archivos fuente. */
export interface ProviderGroup {
  readonly service: string;
  readonly key: string;
  readonly boundConsumers: number;
  readonly providers: readonly ContractProvider[];
}

export interface GraphqlNoOpCorrelation {
  readonly total: number;
  readonly matchedToSignals: number;
  readonly unmatched: ReadonlyArray<{
    repo: string;
    path: string;
    key: string;
    consumerId: string;
  }>;
  /** `graphql:op:field` → número de nodos consumidor (call-sites). */
  readonly byKey: Readonly<Record<string, number>>;
  /** Desglose por repo: total de ítems, correlacionados y llaves distintas. */
  readonly byRepo: Readonly<Record<string, { total: number; matched: number; keys: number }>>;
}

export interface EnvUnmappedCorrelation {
  readonly repo: string;
  readonly consumerId: string;
  readonly envExpr: string;
  readonly matchedVar?: string;
  readonly targetService?: string;
}

export interface Correlation {
  readonly unresolvedTotal: number;
  readonly byReason: Readonly<Record<string, number>>;
  readonly byRepoReason: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly graphqlNoOp: GraphqlNoOpCorrelation;
  readonly envUnmapped: readonly EnvUnmappedCorrelation[];
  /** Llaves con más de un grupo de proveedores (el disparador de graphql_no_op). */
  readonly providerGroups: ReadonlyArray<{ key: string; groups: readonly ProviderGroup[] }>;
  readonly duplicatedKeys: readonly string[];
}

// ---- propuestas --------------------------------------------------------------

export interface ProvidesGraphqlProposal {
  readonly kind: 'provides_graphql';
  readonly service: string;
  readonly repo: string;
  readonly provides_graphql: false;
  readonly evidence: {
    readonly sdlCopies: readonly string[];
    readonly consumption: readonly string[];
  };
}

export interface EnvProposal {
  readonly kind: 'env';
  readonly service: string;
  readonly repo: string;
  readonly env: readonly string[];
  readonly evidence: {
    readonly usage: readonly { file: string; line: number }[];
    readonly unresolvedItems: number;
  };
}

export type BindingStatus = 'applicable' | 'rejected' | 'blocked';

export interface BindingVerdict {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly method_match?: boolean;
  readonly template_match?: string;
}

/**
 * Propuesta de binding. `bindingsEntry` sólo existe con status
 * 'applicable' y es el YAML que devolvió check_binding, verbatim: su
 * symbol/key están calibrados para el matcher del motor.
 */
export interface BindingProposal {
  readonly kind: 'binding';
  readonly consumer: {
    readonly repo: string;
    readonly path: string;
    readonly symbol: string;
    readonly key: string;
  };
  readonly provider: { readonly service: string; readonly key: string };
  readonly consumerId: string;
  readonly evidence: { readonly consumerLine?: number };
  readonly status: BindingStatus;
  readonly verdict: BindingVerdict | null;
  readonly bindingsEntry?: string;
  readonly reason?: string;
}

export interface BindingCapability {
  readonly graphqlBindings: 'supported' | 'unsupported' | 'unknown';
  readonly detail: string;
  /** Veredicto crudo de la llamada de sondeo, para que el usuario lo vea. */
  readonly probe:
    | { readonly ok: true; readonly verdict: BindingVerdict }
    | { readonly ok: false; readonly error: string }
    | null;
}

export interface EnvNoGap {
  readonly repo: string;
  readonly envVar: string;
  readonly files: readonly string[];
  readonly note: string;
}

export interface AdvisorReport {
  readonly snapshot: string;
  readonly capability: BindingCapability;
  readonly findings: readonly AdvisorSignal[];
  readonly signalsByKind: Readonly<Record<SignalKind, number>>;
  readonly correlation: Correlation;
  readonly proposals: {
    readonly providesGraphql: readonly ProvidesGraphqlProposal[];
    readonly env: readonly EnvProposal[];
    readonly envNoGap: readonly EnvNoGap[];
    readonly bindings: readonly BindingProposal[];
    readonly applicableBindings: number;
  };
  readonly yaml: string;
  readonly notes: readonly string[];
}
