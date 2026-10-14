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
    | 'get_coverage'
    | 'resolve_evidence'
    | 'read_source';
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
