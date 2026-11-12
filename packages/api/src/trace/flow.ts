import type { TraceFlowArgs, TraceFlowResponse } from '@parallax/shared/lain';
import type { LainAdapter } from '../lain-adapter/types.js';

export async function traceFlow(
  lain: LainAdapter,
  args: TraceFlowArgs,
): Promise<TraceFlowResponse> {
  return lain.traceFlow(args);
}
