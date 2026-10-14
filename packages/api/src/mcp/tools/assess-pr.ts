import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as schema from '../../db/schema.js';
import { isLainCallError } from '../../lain-adapter/errors.js';
import type { LainAdapter } from '../../lain-adapter/types.js';
import {
  AssessmentRequestBody,
  IdempotencyConflictError,
  NotFoundError,
  createAssessment,
} from '../../services/assessments.js';
import type { AssessmentWorker } from '../../worker/assessment-worker.js';
import { errorResult, jsonResult } from './explore.js';

export const assessPrTool = {
  name: 'parallax_assess_pr',
  description:
    'Trigger a PR impact assessment. Same service as POST /api/assessments: ' +
    'same input digest, same persisted report. Send repo + resolved base/head SHAs.',
  inputSchema: {
    type: 'object',
    properties: {
      prUrl: { type: 'string' },
      orgId: { type: 'string' },
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      configHash: { type: 'string' },
      excludeRepos: { type: 'array', items: { type: 'string' } },
      idempotencyKey: { type: 'string' },
    },
    required: ['orgId'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', additionalProperties: true },
};

// Forma plana (ZodObject) para el registro en el servidor MCP: el SDK extrae
// el shape del objeto; un .refine() la perdería y los argumentos se strippen.
export const assessPrShape = {
  prUrl: z.string().url().optional(),
  orgId: z.string().min(1),
  repo: z.string().min(1).optional(),
  base: z.string().optional(),
  head: z.string().optional(),
  configHash: z.string().min(1).optional(),
  excludeRepos: z.array(z.string().min(1)).optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
};

export interface AssessmentToolDeps {
  db: BetterSQLite3Database<typeof schema>;
  worker: AssessmentWorker;
  lain: LainAdapter;
}

// P09: la tool MCP llama al MISMO servicio que la ruta HTTP; identidad,
// hallazgos y cobertura coinciden por construcción.
export function makeAssessPrHandler(deps: AssessmentToolDeps) {
  return async (args: unknown) => {
    const parsed = AssessmentRequestBody.safeParse(args);
    if (!parsed.success) {
      return errorResult(
        'InvalidArguments',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    try {
      const { assessment, created } = await createAssessment({
        db: deps.db,
        worker: deps.worker,
        body: parsed.data,
        analyzerVersion: deps.lain.analyzerVersion,
      });
      void deps.worker.run(assessment.id).catch(() => {});
      return jsonResult({ assessment, created });
    } catch (e) {
      if (e instanceof IdempotencyConflictError) return errorResult('Conflict', e.message);
      if (e instanceof NotFoundError) return errorResult('NotFound', e.message);
      if (isLainCallError(e)) return errorResult(e.code, e.message);
      return errorResult('InternalError', e instanceof Error ? e.message : String(e));
    }
  };
}

export type AssessPrHandler = ReturnType<typeof makeAssessPrHandler>;
