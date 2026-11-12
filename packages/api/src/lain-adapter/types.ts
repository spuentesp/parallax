import type {
  ApplyContractContextArgs,
  ApplyContractContextResponse,
  AssessChangeArgs,
  AssessChangeResponse,
  CheckBindingArgs,
  CheckBindingResponse,
  DescribeSchemaArgs,
  DescribeSchemaResponse,
  DiffContractsArgs,
  DiffContractsResponse,
  ExplainDispatchArgs,
  ExplainDispatchResponse,
  ExplainSymbolArgs,
  GetCallChainArgs,
  GetCallSitesArgs,
  GetCodeSnippetArgs,
  GetContractArgs,
  GetContractResponse,
  GetCoverageArgs,
  GetCoverageResponse,
  GetCrossRuntimeCallersArgs,
  GetCrossRuntimeCallersResponse,
  GetFederationHealthArgs,
  GetFederationHealthResponse,
  GetServiceArgs,
  GetServiceResponse,
  GetSnapshotArgs,
  GetSnapshotResponse,
  LainTextResponse,
  ListContractsArgs,
  ListContractsResponse,
  ListServiceRefsArgs,
  ListServiceRefsResponse,
  ListServicesArgs,
  ListServicesResponse,
  ListUnresolvedArgs,
  ListUnresolvedResponse,
  LoadPackageArgs,
  LoadPackageResponse,
  PrepareSnapshotArgs,
  PrepareSnapshotResponse,
  QueryGraphArgs,
  QueryGraphResponse,
  ReadSourceArgs,
  ReadSourceResponse,
  ResolveEvidenceArgs,
  ResolveEvidenceResponse,
  SearchCodeArgs,
  SearchCodeResponse,
  TraceFlowArgs,
  TraceFlowResponse,
  TraceImpactArgs,
  TraceImpactResponse,
} from '@parallax/shared/lain';
import type { CodeTool } from '../agent/code-tools.js';
import type { ProductCodeTool } from './product-tools.js';

// Firmas alineadas con las tools reales de lain 0.9.1: todas reciben
// `snapshot` (o `base`/`head` en diff_contracts) y los argumentos homónimos
// de docs/lain-tool-schemas.json. Las 13 del paquete contracts.
// Las del grafo crudo (query_graph y anexas) viven en el paquete `raw`,
// que hay que load_package antes de usarlas.
export interface LainAdapter {
  readonly analyzerVersion: string;
  readonly apiVersion: '1';

  listServices(req: ListServicesArgs): Promise<ListServicesResponse>;
  getService(req: GetServiceArgs): Promise<GetServiceResponse>;
  prepareSnapshot(req: PrepareSnapshotArgs): Promise<PrepareSnapshotResponse>;
  getSnapshot(req: GetSnapshotArgs): Promise<GetSnapshotResponse>;
  listContracts(req: ListContractsArgs): Promise<ListContractsResponse>;
  getContract(req: GetContractArgs): Promise<GetContractResponse>;
  listUnresolved(req: ListUnresolvedArgs): Promise<ListUnresolvedResponse>;
  checkBinding(req: CheckBindingArgs): Promise<CheckBindingResponse>;
  diffContracts(req: DiffContractsArgs): Promise<DiffContractsResponse>;
  traceImpact(req: TraceImpactArgs): Promise<TraceImpactResponse>;
  getCoverage(req: GetCoverageArgs): Promise<GetCoverageResponse>;
  resolveEvidence(req: ResolveEvidenceArgs): Promise<ResolveEvidenceResponse>;
  readSource(req: ReadSourceArgs): Promise<ReadSourceResponse>;

  // Batch v0.15.0 de dev (paquete contracts; el handshake las exige).
  traceFlow(req: TraceFlowArgs): Promise<TraceFlowResponse>;
  listServiceRefs(req: ListServiceRefsArgs): Promise<ListServiceRefsResponse>;
  applyContractContext(req: ApplyContractContextArgs): Promise<ApplyContractContextResponse>;

  // Grafo crudo (paquete raw). El boot del client intenta loadPackage de
  // raw/arch/workspace de forma defensiva; aquí se asumen ya cargadas.
  queryGraph(req: QueryGraphArgs): Promise<QueryGraphResponse>;
  describeSchema(req: DescribeSchemaArgs): Promise<DescribeSchemaResponse>;
  loadPackage(req: LoadPackageArgs): Promise<LoadPackageResponse>;
  // Raw con outputSchema (devuelven structuredContent además del texto).
  searchCode(req: SearchCodeArgs): Promise<SearchCodeResponse>;
  assessChange(req: AssessChangeArgs): Promise<AssessChangeResponse>;
  explainDispatch(req: ExplainDispatchArgs): Promise<ExplainDispatchResponse>;
  getCrossRuntimeCallers(req: GetCrossRuntimeCallersArgs): Promise<GetCrossRuntimeCallersResponse>;
  // Salud de la federación (core): estado por repo con razón.
  getFederationHealth(req: GetFederationHealthArgs): Promise<GetFederationHealthResponse>;
  // Devuelven markdown plano del motor, envuelto como {text} (y, desde el
  // batch v0.15.0, answer_scope vía structuredContent cuando hay outputSchema).
  getCodeSnippet(req: GetCodeSnippetArgs): Promise<LainTextResponse>;
  explainSymbol(req: ExplainSymbolArgs): Promise<LainTextResponse>;
  getCallSites(req: GetCallSitesArgs): Promise<LainTextResponse>;
  getCallChain(req: GetCallChainArgs): Promise<LainTextResponse>;
  /** Herramienta de código de LAIN de la lista permitida (sólo lectura), markdown plano. */
  codeTool(
    tool: CodeTool | ProductCodeTool,
    args: Record<string, unknown>,
  ): Promise<LainTextResponse>;
}
