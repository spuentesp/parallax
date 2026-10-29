import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { type AssessmentToolDeps, assessPrShape, makeAssessPrHandler } from '../tools/assess-pr.js';
import { getAssessmentShape, makeGetAssessmentHandler } from '../tools/get-assessment.js';

const SPEC_DOC =
  'https://github.com/spuentesp/parallax/blob/main/docs/superpowers/specs/2026-10-13-parallax-foundation-design.md';

const exploreShape = {
  orgId: z.string().min(1),
  focus: z.enum(['services', 'consumers', 'providers']).optional(),
  serviceId: z.string().optional(),
};

const getEvidenceShape = {
  assessmentId: z.string().min(1),
  evidenceId: z.string().min(1),
};

// Sin dependencias de app (tests aislados), las tools de asesoría siguen
// devolviendo ApiEndpointNotImplemented con su doc URL.
function notImpl(tool: string) {
  return async (_args: unknown) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          code: 'ApiEndpointNotImplemented',
          message: `${tool} is registered but lands in a later subproject.`,
          doc: SPEC_DOC,
        }),
      },
    ],
    isError: true,
  });
}

// §15 G2 / P09: assess_pr y get_assessment se registran contra los MISMOS
// servicios que las rutas HTTP, usando el worker y la DB de la app.
export function buildMcpServer(deps?: Partial<AssessmentToolDeps>): McpServer {
  const server = new McpServer({ name: 'parallax', version: '0.1.0' });

  server.tool(
    'parallax_explore',
    'Explore an organization: list services, get a service with its consumers. ' +
      'Returns ApiEndpointNotImplemented (with a doc URL) when the underlying endpoint is not yet wired.',
    exploreShape,
    notImpl('parallax_explore'),
  );

  const assessHandler =
    deps?.db && deps.worker && deps.lain
      ? makeAssessPrHandler({
          db: deps.db,
          worker: deps.worker,
          lain: deps.lain,
          ...(deps.github ? { github: deps.github } : {}),
        })
      : notImpl('parallax_assess_pr');
  server.tool(
    'parallax_assess_pr',
    'Trigger a PR impact assessment. Same service as POST /api/assessments: ' +
      'same input digest, same persisted report. Send a PR URL or repo + resolved base/head SHAs.',
    assessPrShape,
    assessHandler,
  );

  const getHandler =
    deps?.db && deps.worker && deps.lain
      ? makeGetAssessmentHandler({ db: deps.db, worker: deps.worker, lain: deps.lain })
      : notImpl('parallax_get_assessment');
  server.tool(
    'parallax_get_assessment',
    'Read a persisted assessment by id. Same service as GET /api/assessments/:id: ' +
      'identity, findings and coverage come from the persisted report.',
    getAssessmentShape,
    getHandler,
  );

  server.tool(
    'parallax_get_evidence',
    'Read a single evidence ref from an assessment. Not implemented in subproject 1.',
    getEvidenceShape,
    notImpl('parallax_get_evidence'),
  );

  return server;
}

export function buildTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}
