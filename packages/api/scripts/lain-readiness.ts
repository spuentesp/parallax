import type { LainAdapter } from '../src/lain-adapter/types.js';

// An HTTP listener can be up while every repo is still indexing. Empty
// catalogs at that point say nothing about the workspace's contracts.
// Desde el batch v0.15.0 de dev, get_federation_health da el estado por repo
// con la razón (Indexing/Ready/Degraded) — se usa para diagnosticar, no para
// decidir: la espera sigue basándose en el scope de list_services.
export async function waitForIndexedRepos(
  lain: LainAdapter,
  repos: readonly string[],
  timeoutMs = Number(process.env.LAIN_INDEX_TIMEOUT_MS ?? 900_000),
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await lain.listServices({ snapshot: 'live' });
    const reviewed = new Set(result.scope.reviewed.map((r) => r.repo));
    const pending = repos.filter((r) => !reviewed.has(r));
    if (pending.length === 0 && result.scope.unreviewed.length === 0) return;
    if (Date.now() >= deadline) {
      let health = '';
      try {
        const h = await lain.getFederationHealth({});
        health = `; federation health: ${JSON.stringify(h.repos)}`;
      } catch {
        // get_federation_health es diagnóstico: si falla, el error original basta.
      }
      throw new Error(`LAIN indexing incomplete: ${JSON.stringify(result.scope)}${health}`);
    }
    console.log(`Waiting for indexed repos: ${pending.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
