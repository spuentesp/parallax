# Notas de integración con LAIN

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
