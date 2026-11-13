// Detalle de un contrato (referencia "Contract detail"): quién lo provee, qué
// campos tiene y quién lee cada uno. Todo sale de `get_contract` de LAIN; aquí
// sólo se normaliza esa respuesta (que el adaptador tipa como objetos sueltos) a
// una forma estable para la interfaz. No se inventa nada: un campo sin lector
// conocido lo es "dentro del alcance analizado" (ver `readsComplete`), no "seguro".

export interface ContractSite {
  repo: string;
  path: string;
  line: number;
}

export interface ContractField {
  name: string;
  type: string;
  nullable: boolean;
  required: boolean;
  enumValues: string[] | null;
}

export interface ContractSchemaDto {
  direction: string;
  fields: ContractField[];
}

export interface FieldRead {
  field: string;
  confidence: number | null;
  provenance: string | null;
  site: ContractSite | null;
}

export interface ContractConsumer {
  repo: string;
  caller: string | null;
  site: ContractSite | null;
  match: string | null;
  confidence: number | null;
  bindingKind: string | null;
  bindingSource: string | null;
  /** Si LAIN afirma haber visto TODAS las lecturas de campos de este consumidor. */
  readsComplete: boolean | null;
  reads: FieldRead[];
}

export interface ContractDetailDto {
  source: 'lain' | 'unconfigured' | 'error';
  error?: string;
  key: string;
  service: string | null;
  kind: string;
  providers: Array<ContractSite & { symbol: string | null }>;
  schemas: ContractSchemaDto[];
  consumers: ContractConsumer[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function site(v: unknown): ContractSite | null {
  const o = obj(v);
  const repo = str(o.repo);
  const path = str(o.path);
  if (repo === null || path === null) return null;
  return { repo, path, line: num(o.line) ?? 0 };
}

/** `graphql:query:checkout` → `graphql query`; `http:GET /x` → `http`. */
export function contractKindOf(key: string): string {
  const [kind = '', second = ''] = key.split(':');
  return kind === 'graphql' && /^(query|mutation|subscription)$/.test(second)
    ? `graphql ${second}`
    : kind;
}

export function normalizeContract(
  key: string,
  service: string | null,
  raw: unknown,
): ContractDetailDto {
  // get_contract devuelve { items: [ ... ] }: se toma el que coincide con la clave.
  const items = arr(obj(raw).items).map(obj);
  const item = items.find((i) => str(obj(i.endpoint).key) === key) ?? items[0] ?? {};

  const providers = arr(item.providers).flatMap((p) => {
    const s = site(p);
    return s ? [{ ...s, symbol: str(obj(p).id) }] : [];
  });

  const schemas = arr(item.schemas).map((sc) => ({
    direction: str(obj(sc).direction) ?? 'unknown',
    fields: arr(obj(sc).fields).flatMap((f) => {
      const o = obj(f);
      const name = str(o.json_path);
      if (name === null) return [];
      return [
        {
          name,
          type: str(o.ty) ?? 'unknown',
          nullable: o.nullable === true,
          required: o.required === true,
          enumValues: Array.isArray(o.enum_values) ? o.enum_values.map(String) : null,
        },
      ];
    }),
  }));

  const consumers = arr(item.consumers).map((c): ContractConsumer => {
    const o = obj(c);
    const caller = obj(o.caller);
    const binding = obj(o.binding);
    const at = site(o.site) ?? site(o.caller);
    return {
      repo: str(caller.repo) ?? at?.repo ?? '',
      caller: str(caller.name),
      site: at,
      match: str(o.match),
      confidence: num(binding.confidence),
      bindingKind: str(binding.kind),
      bindingSource: str(binding.source),
      readsComplete: typeof o.reads_complete === 'boolean' ? o.reads_complete : null,
      reads: arr(o.reads).flatMap((r) => {
        const ro = obj(r);
        const field = str(ro.json_path);
        if (field === null) return [];
        const prov = obj(ro.provenance);
        return [
          {
            field,
            confidence: num(prov.confidence),
            provenance: str(prov.kind),
            site: site(ro.site),
          },
        ];
      }),
    };
  });

  return {
    source: 'lain',
    key,
    service,
    kind: contractKindOf(key),
    providers,
    schemas,
    consumers,
  };
}
