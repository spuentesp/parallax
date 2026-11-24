import type * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  type ContractConsumerDto,
  type ContractDetailDto,
  useContractDetail,
} from '../api/hooks.js';

// Detalle de un contrato (referencia "Contract detail"): quién lo provee, qué
// campos tiene y quién lee cada uno. Todo es lo que LAIN devuelve en get_contract.
// "Sin lector conocido" sólo se afirma dentro del alcance analizado: si algún
// consumidor no garantiza haber visto todas sus lecturas, se dice.

/** Probado = ligadura estática con confianza total; lo demás es inferido, con su puntuación. */
export function provenanceOf(c: Pick<ContractConsumerDto, 'bindingKind' | 'confidence'>): {
  proven: boolean;
  label: string;
} {
  const proven = c.bindingKind === 'static' && (c.confidence ?? 1) >= 1;
  return {
    proven,
    label: proven
      ? 'proven'
      : `inferred${c.confidence !== null ? ` ${c.confidence.toFixed(2)}` : ''}`,
  };
}

function Pill({ proven, children }: { proven: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        proven ? 'border-deterministic text-fg' : 'border-dashed border-inferred text-warning'
      }`}
    >
      {children}
    </span>
  );
}

interface FieldRow {
  name: string;
  type: string;
  direction: string;
  required: boolean;
  nullable: boolean;
  readers: Array<{ repo: string; sites: number; proven: boolean }>;
}

/** Cruza los campos del proveedor con las lecturas de cada consumidor. */
export function fieldRows(d: ContractDetailDto): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const s of d.schemas) {
    for (const f of s.fields) {
      const byRepo = new Map<string, { sites: number; proven: boolean }>();
      for (const c of d.consumers) {
        for (const r of c.reads) {
          if (r.field !== f.name) continue;
          const cur = byRepo.get(c.repo) ?? { sites: 0, proven: true };
          cur.sites += 1;
          if (r.provenance !== 'static' || (r.confidence ?? 1) < 1) cur.proven = false;
          byRepo.set(c.repo, cur);
        }
      }
      rows.push({
        name: f.name,
        type: f.type,
        direction: s.direction,
        required: f.required,
        nullable: f.nullable,
        readers: [...byRepo].map(([repo, v]) => ({ repo, ...v })),
      });
    }
  }
  return rows;
}

export function ContractDetail(): React.ReactElement {
  const { orgId } = useParams<{ orgId: string }>();
  const [params] = useSearchParams();
  const key = params.get('key');
  const service = params.get('service');
  const q = useContractDetail(orgId, key, service);
  const d = q.data;

  if (!key) {
    return <p className="p-6 text-sm text-muted">No contract selected.</p>;
  }
  if (q.isPending) return <p className="p-6 text-sm text-muted">Reading the engine…</p>;
  if (q.isError || !d)
    return <p className="p-6 text-sm text-error">Could not load this contract.</p>;
  if (d.source !== 'lain') {
    return (
      <p className="p-6 text-sm text-muted">
        {d.source === 'unconfigured'
          ? 'This workspace has no LAIN server configured.'
          : `LAIN error: ${d.error ?? 'unreachable'}.`}
      </p>
    );
  }

  const rows = fieldRows(d);
  const read = rows.filter((r) => r.readers.length > 0).length;
  const unread = rows.length - read;
  const incomplete = d.consumers.some((c) => c.readsComplete === false);
  const provider = d.providers[0];
  const proven = d.consumers.filter((c) => provenanceOf(c).proven);
  const inferred = d.consumers.length - proven.length;
  const name = d.key.split(':').slice(2).join(':') || d.key.split(':').slice(1).join(':') || d.key;
  const consumersByRepo = new Map<string, ContractConsumerDto[]>();
  for (const c of d.consumers)
    consumersByRepo.set(c.repo, [...(consumersByRepo.get(c.repo) ?? []), c]);
  const ask = encodeURIComponent(
    `Who consumes ${d.key}${d.service ? ` from ${d.service}` : ''}, and which of its fields does nobody read?`,
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6 pb-24" data-testid="contract-detail">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted">
        <Link to={`/orgs/${orgId}/contracts`} className="hover:text-fg">
          Contracts
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-mono text-xs text-fg">{d.key}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{d.kind}</div>
          <h1 className="font-mono text-2xl font-semibold">{name}</h1>
          <p className="mt-1 text-sm text-muted">
            {provider
              ? `Provided by ${d.service ?? provider.repo}${
                  d.service && d.service !== provider.repo ? ` in ${provider.repo}` : ''
                }. `
              : ''}
            {proven.length} proven consumer{proven.length === 1 ? '' : 's'}
            {inferred > 0 ? `, ${inferred} inferred` : ''}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/orgs/${orgId}?${new URLSearchParams({ trace: d.key, ...(d.service ? { tservice: d.service } : {}) })}`}
            title="Follow this contract end to end on the map"
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
          >
            Trace impact
          </Link>
          <Link
            to={`/orgs/${orgId}?ask=${ask}`}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
          >
            Ask about this
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Provider" className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Provider</h2>
          {provider ? (
            <div className="space-y-1 text-sm">
              <div className="font-semibold">{d.service ?? provider.repo}</div>
              <div className="text-xs text-muted">
                repo <span className="font-mono">{provider.repo}</span>
              </div>
              <div className="font-mono text-xs">
                {provider.path}
                {provider.line ? `:${provider.line}` : ''}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">The engine reports no provider location.</p>
          )}
        </section>

        <section aria-label="Contract" className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Contract</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">The engine has no schema for this contract.</p>
          ) : (
            <p className="text-sm">
              {rows.length} field{rows.length === 1 ? '' : 's'}: {read} read by consumers,{' '}
              <b>{unread}</b> with no known reader
              {incomplete ? ' (some consumers may read fields the engine did not see)' : ''}.
            </p>
          )}
        </section>
      </div>

      <section aria-label="Consumers" className="rounded-xl border border-border bg-surface">
        <h2 className="border-b border-border p-3 text-sm font-semibold">
          Consumers{' '}
          <span className="font-normal text-muted">({d.consumers.length} call sites)</span>
        </h2>
        {d.consumers.length === 0 ? (
          <p className="p-3 text-sm text-muted">
            No bound consumers. Unresolved calls and unindexed repos are outside this list.
          </p>
        ) : (
          <ul>
            {[...consumersByRepo].map(([repo, cs]) => {
              const p = cs.every((c) => provenanceOf(c).proven);
              const first = cs[0] as ContractConsumerDto;
              return (
                <li
                  key={repo}
                  className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
                >
                  <span className="font-mono text-sm">{repo}</span>
                  <span className="text-xs text-muted">
                    {cs.length} call site{cs.length === 1 ? '' : 's'}
                    {first.site ? ` · e.g. ${first.site.path}:${first.site.line}` : ''}
                  </span>
                  <span className="ml-auto">
                    <Pill proven={p}>{p ? 'proven' : provenanceOf(first).label}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {rows.length > 0 && (
        <section aria-label="Fields" className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-3">
            <h2 className="text-sm font-semibold">Fields and who reads them</h2>
            <p className="text-xs text-muted">
              A field with no known reader looks safe to change, within the analyzed scope.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Field
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Direction
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Read by
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Provenance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.direction}:${r.name}`} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.name}
                      {r.required && <span className="ml-1 text-warning">*</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {r.type}
                      {r.nullable ? '?' : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.direction}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.readers.length === 0 ? (
                        <span className="text-muted">no known reader</span>
                      ) : (
                        r.readers.map((x) => `${x.repo} (${x.sites})`).join(', ')
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.readers.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <Pill proven={r.readers.every((x) => x.proven)}>
                          {r.readers.every((x) => x.proven) ? 'proven' : 'inferred'}
                        </Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
