export interface MockCall {
  readonly tool:
    | 'list_services'
    | 'get_service'
    | 'prepare_snapshot'
    | 'get_snapshot'
    | 'diff_contracts'
    | 'trace_impact'
    | 'get_coverage'
    | 'resolve_evidence'
    | 'read_source';
  readonly args: unknown;
  readonly view?: string;
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
