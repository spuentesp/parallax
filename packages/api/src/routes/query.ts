import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NemotronProvider } from '../agent/nemotron.js';
import { runQuery } from '../agent/query-agent.js';

const QueryRequest = z.object({
  question: z.string().min(1),
  orgId: z.string().min(1),
});

const QueryResponse = z.object({
  answer: z.string(),
  topology: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        kind: z.string(),
      }),
    ),
    edges: z.array(
      z.object({
        source: z.string(),
        target: z.string(),
        label: z.string().optional(),
        kind: z.string(),
      }),
    ),
  }),
  evidence: z.array(z.unknown()),
});

export const queryRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/query',
    {
      config: { scopes: ['read'] },
      schema: {
        body: QueryRequest,
        response: { 200: QueryResponse },
      },
    },
    async (req) => {
      const { question } = req.body as { question: string; orgId: string };
      const nemotronToken = app.config.nemotronToken;
      if (!nemotronToken) {
        return {
          answer: 'Nemotron no está configurado (NEMOTRON_TOKEN). Usando topología de ejemplo.',
          topology: { nodes: [], edges: [] },
          evidence: [],
        };
      }

      const nemotron = new NemotronProvider({
        baseUrl: 'https://api.tokenfactory.nebius.com/v1',
        apiKey: nemotronToken,
        plannerModel: 'nvidia/nemotron-3-super-120b-a12b',
        workerModel: 'nvidia/Nemotron-3_5-Lightning',
      });

      const result = await runQuery({ nemotron, lain: app.lain }, question);
      return result;
    },
  );
};
