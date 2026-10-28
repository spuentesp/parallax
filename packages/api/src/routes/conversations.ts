import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createConversationStore, ownerOf } from '../conversation/store.js';

// Mis conversaciones. Todo va filtrado por el dueño (hash del token): una id que
// no es mía responde 404, igual que una que no existe.
export const conversationRoutes: FastifyPluginAsync = async (app) => {
  const store = createConversationStore(app.db);
  const who = (req: { authToken?: { token: string } | undefined }) =>
    ownerOf(req.authToken?.token ?? 'anonymous');

  app.get(
    '/api/conversations',
    {
      config: { scopes: ['read'] },
      schema: { querystring: z.object({ workspaceId: z.string().min(1).optional() }).loose() },
    },
    async (req) => {
      const { workspaceId } = req.query as { workspaceId?: string };
      return { conversations: await store.list(who(req), workspaceId) };
    },
  );

  app.get(
    '/api/conversations/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req, reply) => {
      const found = await store.get(who(req), (req.params as { id: string }).id);
      if (!found)
        return reply.code(404).send({ code: 'NotFound', detail: 'conversation not found' });
      return {
        conversation: found.conversation,
        turns: found.turns.map((t) => ({
          seq: t.seq,
          question: t.question,
          answer: t.answer,
          status: t.status,
          claims: t.claimResults,
          focus: t.focus,
          model: t.model,
          createdAt: t.createdAt,
        })),
      };
    },
  );

  app.delete(
    '/api/conversations/:id',
    {
      config: { scopes: ['read'] },
      schema: { params: z.object({ id: z.string().min(1) }) },
    },
    async (req, reply) => {
      const ok = await store.remove(who(req), (req.params as { id: string }).id);
      if (!ok) return reply.code(404).send({ code: 'NotFound', detail: 'conversation not found' });
      return { deleted: true };
    },
  );
};
