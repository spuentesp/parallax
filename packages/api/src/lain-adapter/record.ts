import type { CodeTool } from '../agent/code-tools.js';
import type { ProductCodeTool } from './product-tools.js';

export interface MockCall {
  readonly tool:
    | 'list_services'
    | 'get_service'
    | 'prepare_snapshot'
    | 'get_snapshot'
    | 'list_contracts'
    | 'get_contract'
    | 'list_unresolved'
    | 'check_binding'
    | 'diff_contracts'
    | 'trace_impact'
    | 'trace_flow'
    | 'apply_contract_context'
    | 'list_service_refs'
    | 'get_coverage'
    | 'resolve_evidence'
    | 'read_source'
    | 'query_graph'
    | 'describe_schema'
    | 'load_package'
    | 'get_code_snippet'
    | 'explain_symbol'
    | 'get_call_sites'
    | CodeTool
    | ProductCodeTool;
  readonly args: unknown;
  readonly snapshot?: string;
  readonly at: number;
}

let calls: MockCall[] = [];

export function recordMockCall(call: Omit<MockCall, 'at'>): void {
  calls.push({ ...call, at: Date.now() });
}

export function getLainMockCalls(): readonly MockCall[] {
  return calls;
}

export function resetLainMock(): void {
  calls = [];
}
