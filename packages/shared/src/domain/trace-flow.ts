import { z } from 'zod';
import { TraceFlowArgs } from '../lain/tools.js';

export const TraceFlowBody = TraceFlowArgs;
export const TraceFlowInput = TraceFlowArgs.extend({
  workspaceId: z.string().min(1),
});

export type TraceFlowBody = z.infer<typeof TraceFlowBody>;
export type TraceFlowInput = z.infer<typeof TraceFlowInput>;
