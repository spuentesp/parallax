// QueryAgent — LangGraph agent that answers architectural questions
// using lain tools. Flow: plan → query_lain → analyze → curate → respond.

import { Annotation, StateGraph } from '@langchain/langgraph';
import type { LainAdapter } from '../lain-adapter/types.js';
import type { TopologyViewData } from '../topology.js';
import type { NemotronProvider, ToolSpec } from './nemotron.js';

const AgentState = Annotation.Root({
  question: Annotation<string>,
  plan: Annotation<string[]>,
  discovered: Annotation<{ services: unknown[]; symbols: unknown[]; contracts: unknown[] }>,
  budget: Annotation<{ toolCalls: number; tokens: number }>,
  evidence: Annotation<unknown[]>,
  topology: Annotation<TopologyViewData>,
  answer: Annotation<string>,
  step: Annotation<number>,
});

const _LAIN_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_services',
      description: 'List all services in the organization.',
      parameters: {
        type: 'object',
        properties: { snapshot: { type: 'string' } },
        required: ['snapshot'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service',
      description: 'Get a service with its consumers.',
      parameters: {
        type: 'object',
        properties: { snapshot: { type: 'string' }, service: { type: 'string' } },
        required: ['snapshot', 'service'],
      },
    },
  },
];

export interface QueryAgentDeps {
  nemotron: NemotronProvider;
  lain: LainAdapter;
}

export function buildQueryAgent(deps: QueryAgentDeps) {
  const graph = new StateGraph(AgentState)
    .addNode('planner', async (state) => {
      const resp = await deps.nemotron.complete(
        [
          {
            role: 'system',
            content: 'Decompose the question into 2-4 lain tool queries. Return ONLY a JSON array.',
          },
          { role: 'user', content: state.question },
        ],
        { model: 'planner', maxTokens: 512 },
      );
      let plan: string[] = [];
      try {
        plan = JSON.parse(resp.content ?? '[]') as string[];
      } catch {
        plan = ['list_services'];
      }
      return { plan, step: (state.step ?? 0) + 1 };
    })
    .addNode('query_lain', async (state) => {
      const discovered = state.discovered ?? { services: [], symbols: [], contracts: [] };
      for (const q of state.plan ?? []) {
        if (state.budget && state.budget.toolCalls <= 0) break;
        if (q.startsWith('list_services')) {
          const r = await deps.lain.listServices({ snapshot: 'live' });
          discovered.services = r.items;
        } else if (q.startsWith('get_service(')) {
          const svc = q.match(/get_service\((.+)\)/)?.[1];
          if (svc) {
            try {
              const r = await deps.lain.getService({ snapshot: 'live', service: svc });
              discovered.symbols.push({ service: r.service, consumers: r.consumers });
            } catch {
              // skip
            }
          }
        }
        if (state.budget) state.budget.toolCalls -= 1;
      }
      return { discovered, step: (state.step ?? 0) + 1 };
    })
    .addNode('analyze', async (state) => {
      const resp = await deps.nemotron.complete(
        [
          {
            role: 'system',
            content: 'Analyze the discovered services. Answer the question directly.',
          },
          {
            role: 'user',
            content: `Question: ${state.question}\n\nDiscovered: ${JSON.stringify(state.discovered)}`,
          },
        ],
        { model: 'worker', maxTokens: 1024 },
      );
      return { answer: resp.content ?? '', step: (state.step ?? 0) + 1 };
    })
    .addNode('curate', async (state) => {
      const services = state.discovered?.services ?? [];
      const nodes: TopologyViewData['nodes'] = services.map((s: unknown) => {
        const obj = s as Record<string, unknown>;
        return {
          id: (obj.service as string) ?? 'unknown',
          label: (obj.service as string) ?? 'unknown',
          kind: 'service' as const,
        };
      });
      const edges: TopologyViewData['edges'] = [];
      const symbols = state.discovered?.symbols ?? [];
      for (const sym of symbols) {
        const svc = sym as {
          service?: string;
          consumers?: Array<{ service: string }>;
        };
        for (const c of svc.consumers ?? []) {
          edges.push({
            source: c.service,
            target: svc.service ?? 'unknown',
            label: 'consumes',
            kind: 'consumes' as const,
          });
        }
      }
      return { topology: { nodes, edges }, step: (state.step ?? 0) + 1 };
    })
    .addNode('respond', async (state) => ({
      answer: state.answer ?? 'No pude responder la pregunta.',
      step: (state.step ?? 0) + 1,
    }))
    .addEdge('__start__', 'planner')
    .addEdge('planner', 'query_lain')
    .addEdge('query_lain', 'analyze')
    .addEdge('analyze', 'curate')
    .addEdge('curate', 'respond');

  return graph.compile();
}

export interface QueryResult {
  answer: string;
  topology: TopologyViewData;
  evidence: unknown[];
}

export async function runQuery(deps: QueryAgentDeps, question: string): Promise<QueryResult> {
  const agent = buildQueryAgent(deps);
  const result = await agent.invoke({
    question,
    plan: [],
    discovered: { services: [], symbols: [], contracts: [] },
    budget: { toolCalls: 8, tokens: 50000 },
    evidence: [],
    topology: { nodes: [], edges: [] },
    answer: '',
    step: 0,
  });
  return {
    answer: result.answer ?? '',
    topology: result.topology ?? { nodes: [], edges: [] },
    evidence: result.evidence ?? [],
  };
}
