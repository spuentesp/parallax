import { z } from 'zod';
import { LainView } from '../lain/enums.js';
import { TraceFlowArgs } from '../lain/tools.js';

export const TraceFlowBody = TraceFlowArgs;
export const TraceFlowInput = TraceFlowArgs.extend({
  workspaceId: z.string().min(1),
  // La vista la fija el despachante en el lado API; por defecto live.
  snapshot: LainView.default('live'),
});

export type TraceFlowBody = z.infer<typeof TraceFlowBody>;
export type TraceFlowInput = z.infer<typeof TraceFlowInput>;
