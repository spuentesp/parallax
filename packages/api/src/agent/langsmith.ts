// LangSmith tracing for Nemotron calls. Uses the hackathon key.
// Every model call is traced: model, latency, tokens, tool calls.

import { Client } from 'langsmith';

let client: Client | null = null;

export function getLangSmithClient(): Client | null {
  if (client) return client;
  // El .env del hackathon trae LANGSMITH_KEY; el SDK espera LANGSMITH_API_KEY.
  // Aceptamos ambos para que el tracing no dependa del nombre de la variable.
  const apiKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGSMITH_KEY;
  if (!apiKey) return null;
  client = new Client({ apiKey });
  return client;
}

export async function traceNemotronCall(data: {
  runId: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls?: number;
  question?: string;
  answer?: string;
}): Promise<void> {
  const ls = getLangSmithClient();
  if (!ls) return;
  try {
    await ls.createRun({
      name: 'nemotron_call',
      run_type: 'llm',
      inputs: { question: data.question ?? '' },
      outputs: { answer: data.answer ?? '' },
      extra: {
        model: data.model,
        latency_ms: data.latencyMs,
        prompt_tokens: data.promptTokens,
        completion_tokens: data.completionTokens,
        tool_calls: data.toolCalls ?? 0,
      },
    });
  } catch {
    // Tracing is best-effort; never fail the agent.
  }
}
