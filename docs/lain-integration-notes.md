# Notas de integración con LAIN

## Actualización 2026-11-10: pin a dev (batch v0.15.0, `b7fd2935`)

Parallax apunta ahora a `origin/dev` de lain (`b7fd2935`, el batch v0.15.0).
Un build de dev reporta `analyzer_version = "0.14.0"` (`CARGO_PKG_VERSION`);
el boot de Parallax no fija el string (sólo `api_version: "1"` y que
`analyzer_version` exista), y `gate-graphql.ts` lo fija en `0.14.0` (override
con `LAIN_EXPECTED_ANALYZER_VERSION`).

Deltas del contrato respecto a v0.13.0 y cómo los cubre Parallax:

1. **Versión del analizador / snapshots entre upgrades.** `diff_contracts`
   rechaza base/head grabados bajo otra `analyzer_version`
   (`analyzer_mismatch`). El worker re-prepara los snapshots una vez
   (transición `ANALYZING → SNAPSHOTTING`) y reintenta el análisis con los
   ids nuevos; un segundo mismatch es fallo real.
2. **`get_contract`**: los handlers de cada ref pasan de string a
   `{repo, file, symbol}`. El espejo Zod lo modela (`HandlerRef`); el adaptador
   real no valida respuestas en runtime, así que no hay rotura.
3. **Vocabulario de `list_unresolved`**: `dynamic_target` sale de
   `no_route_in_service` (ruta elegida en runtime sin servicio atribuible).
   El espejo expone `UnresolvedReason` con las 15 razones; `gate-advisor.ts`
   valida que todas las razones del storefront estén en el vocabulario en vez
   de fijar una etiqueta vieja.
4. **`FEDERATION_GRAPH_VERSION` 4 → 5**: sólo operador — `lain reindex` una vez
   por data dir antes de arrancar el servidor nuevo.

El resto del batch queda consumido por Parallax (ver "Consumo completo del
batch dev" abajo): `structuredContent` junto al texto (el adaptador ya lo
prefiere), `answer_scope`, `trace_flow` y las tools raw nuevas en el
despachante, `edges`/`paths` de `query_graph` en el code graph, paquete
`contracts` con 16 tools, `max_hops`/`timeout_ms` opcionales en
`diff_contracts` (el client los reenvía), `truncated`/`truncation_reason` en
la respuesta del diff, `list_service_refs` en el advisor,
`apply_contract_context` en la ruta del advisor y en `gate-graphql`, y
`get_federation_health` en `lain-readiness.ts`.

`docs/lain-tool-schemas.json` se recapturó con `tools/list` del build de dev.

## Actualización 2026-10-21: release 0.11.0

La release [v0.11.0](https://github.com/spuentesp/lain/releases/tag/v0.11.0)
implementa `provides_graphql: false`, bindings GraphQL y `edges`/`paths` en
consultas `query_graph` con `connect`. El fixture de contratos pasa G1
(26 comprobaciones), G2 (37) y el gate de grafo (21) con ese binario.

Parallax carga `contracts` al conectar a un servidor con perfil core y lee
`analyzer_version` del envelope antes de calcular el primer digest. Ya no usa
la versión fija `0.9.0`. Un API incompatible o sin versión del analizador falla
al conectar, para no certificar una identidad inventada.

Los gates del advisor y de Saleor esperan a que todos los repos estén revisados:
un listener HTTP activo con un catálogo vacío durante el indexado no prueba
que no haya consumidores. `pnpm gate:saleor` comprueba la flecha del storefront,
la supresión de providers del dashboard y el YAML de `check_binding`; requiere
aplicar la propuesta del advisor a la configuración antes de ejecutarlo.

Las entradas que siguen documentan el comportamiento histórico de 0.9.1.
Sus restricciones sobre GraphQL y edges/paths ya no describen 0.11.0.

## Registro de 0.9.1

Divergencias verificadas contra el motor real (`lain 0.9.1`, 2026-10-14). Sirven
para no volver a caer en las mismas y para saber qué depende de un PR de LAIN.

Cada entrada tiene la evidencia que la sostiene. Donde el motor no puede
resolver algo, queda dicho así: un resultado vacío no autoriza a concluir nada
(INV 3).

## 1. `env` va en el provider, no en el consumidor

**Estado:** el contrato de LAIN (`docs/superpowers/plans/2026-10-14-parallax-requirements.md`
§5, en el repo de LAIN) muestra el ejemplo sobre el consumidor:

```yaml
  - name: saleor-storefront
    repo: storefront
    env: [NEXT_PUBLIC_SALEOR_API_URL]
```

**Esto está mal.** La semántica del motor es que `env` se declara en el servicio
**al que la variable resuelve** — el provider. Es lo que hace que
`shipping → inventory` se resuelva en el fixture con `httpx.get(f"{INVENTORY_URL}/…")`
declarando `env: [INVENTORY_URL]` sobre `inventory`.

El advisor de Parallax sigue la semántica del motor (`advisor/propose.ts`). El
contrato de LAIN necesita corregirse en su repo.

## 2. `provides_graphql: false` no está implementado en 0.9.1

El knob del PR de LAIN es la solución correcta al `graphql_no_op` de Saleor, pero
en este build se ignora.

**Evidencia (A/B, los tres repos indexados hasta `unreviewed=0`):**

| | `list_unresolved` storefront | providers de `graphql:query:product` |
|---|---|---|
| con `provides_graphql: false` | 78 (`graphql_no_op: 63`) | 3 |
| sin él | 78 (`graphql_no_op: 63`) | 3 |

Idénticos. Y el loader de config es **permisivo**: acepta
`clave_inexistente_xyz: 42` sin error, así que "aceptado" no significa
"entendido".

Consecuencia: el criterio §7 del contrato (que aparezca la flecha
`storefront → saleor-api`) es **imposible con este motor**.

## 3. `check_binding` rechaza claves GraphQL

`check_binding` con `endpoint.key: "graphql:query:product"` →

```
invalid_argument: "topic endpoints not supported in 0.9"
```

Las claves `http:` sí devuelven veredicto. El advisor degrada: 0 bindings
aplicables y el motivo a la vista, en vez de emitir YAML inventado.

## 4. `query_graph` no viene cargado

Vive en el package `raw`, y el perfil por defecto solo trae `core`. Hay que
`load_package {"package":"raw"}` (y `arch`, `workspace`) antes de usarlo. El
adaptador los carga al arrancar.

En modo federación exige `repo_id`: sin él,
`Config error: tool 'query_graph' requires scoping: multiple repos`.

## 5. `docs/query-language.md` está desincronizado del motor

| Documento | Motor 0.9.1 |
|---|---|
| argumento `spec` | argumento **`query`** |
| resultado con `edges`, `paths`, `groups` | **no los devuelve**; sí un `occupancy` indocumentado |
| `find.id` selecciona por UUID | **inerte** — matchea el repo entero |
| 18 tipos de nodo, 12 de arista | **23 y 26** (`describe_schema` es la autoridad) |
| `Imports` operativo | figura en el esquema con `indexed: false` |

Por eso los vecinos de comunicación del code graph se agrupan **por tipo de
arista** (una consulta por tipo) en vez de pares: el array `edges` nunca llega.
No se fabrican pares que el motor no da.

## 6. `list_unresolved` pagina por defecto

Página default de 100 ítems. Sumar una sola página produjo el falso "el
storefront tiene 0 ítems". **Paginar a exhaustión** es obligatorio; el campo
`candidates` de cada ítem es inútil para GraphQL (lista todos los endpoints HTTP
del índice) y no debe usarse como candidatos.

## 7. Tools que devuelven Markdown, no JSON

`get_context`, `find_symbol`, `find_anchors`, `find_related`, `get_blast_radius`,
`get_layered_map`, `get_code_snippet`, `get_call_sites` devuelven prosa para
agentes. Son útiles para el detalle, pero **no para construir grafos**: para
estructura, `query_graph` (JSON) o las tools de contratos.

## Consumo completo del batch dev (2026-11-11)

Todo el batch v0.15.0 de `origin/dev` (`b7fd2935`) está cableado:

- **Despachante del agente** (`src/agent/dispatcher.ts`): 15 tools de solo
  lectura — las 9 originales más `trace_flow`, `search_code`, `get_call_chain`,
  `get_cross_runtime_callers`, `assess_change`, `explain_dispatch`.
  `checkScope` entiende `from.endpoint.service` anidado y `repo_id`.
- **Code graph** (`src/code-graph.ts`, web `CodeGraphTree.tsx`):
  `query_graph` connect devuelve `edges` (`{id,type,from,to}`) y `paths`
  (`{nodes,edges}`); el árbol rotula los pares from→to reales y renderiza la
  sección de paths. El client normaliza `nodes`/`edges`/`paths` ausentes a
  `[]` (el motor los omite cuando están vacíos). `get_code_snippet` puede
  traer `answer_scope`, que el panel de fuente muestra (INV 3 visible).
- **Advisor** (`src/advisor/`): `list_service_refs` (live-only, args
  `snapshot`/`repo`/`outcome`/`usage`, no `repo_id`) alimenta
  `correlation.serviceRefs` con `byOutcome`/`byRepo`/`unresolvedProduction`/
  `resolvedLinked`. Ojo: en federaciones con binding por env (como el
  fixture Saleor) ningún literal de host resuelve a un servicio — el
  binding env→servicio vive en la capa de contratos (`check_binding`), así
  que `resolved` puede ser legitimamente 0.
- **Aplicación de bindings** (`POST /api/workspaces/:id/advisor/apply`,
  `scripts/gate-graphql.ts`): `apply_contract_context` escribe el
  `repos.yaml` del servidor (con `.bak`) y lo sirve sin reiniciar;
  `dry_run` por defecto true, `applied: true` sólo cuando quedó sirviendo.
- **Readiness** (`scripts/lain-readiness.ts`): ante timeout de índice se
  consulta `get_federation_health` (sin args, paquete core) para distinguir
  "indexando" de "degradado".
- **Envelopes**: el client propaga `cause` con el error del motor
  (p. ej. `analyzer_mismatch`), reenvía `view` y verifica el eco de la vista;
  `diff_contracts` reenvía `max_hops`/`timeout_ms` y el worker vuelca
  `truncated`/`truncation_reason` a gaps del reporte.

Para CI con gates de release: `LAIN_REQUIRE_STARTUP_CACHE=1` hace que el
servidor de lain reutilice checkpoints de federación validados en arranques
sin cambios (más rápido en runners fríos); ver `docs/STARTUP_CACHE.md` de
lain.
