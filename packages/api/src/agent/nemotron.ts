// Nemotron provider — OpenAI-compatible client for Nebius Token Factory.
// No SDK, just fetch. Handles tool-calling, rate limits, and cost tracking.

export interface NemotronConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly plannerModel: string;
  readonly workerModel: string;
  readonly timeoutMs?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface NemotronResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
  model: string;
  latencyMs: number;
}

export class NemotronProvider {
  private readonly cfg: NemotronConfig;
  private readonly timeoutMs: number;

  constructor(cfg: NemotronConfig) {
    this.cfg = cfg;
    this.timeoutMs = cfg.timeoutMs ?? 60_000;
  }

  async complete(
    messages: ChatMessage[],
    opts: {
      model?: 'planner' | 'worker';
      tools?: ToolSpec[];
      toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
      maxTokens?: number;
    } = {},
  ): Promise<NemotronResponse> {
    const model = opts.model === 'planner' ? this.cfg.plannerModel : this.cfg.workerModel;
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: opts.maxTokens ?? 4096,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? 'auto';
    }

    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Nemotron HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: ToolCall[];
          };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
        model: string;
      };
      const choice = data.choices[0];
      if (!choice) throw new Error('no choices in Nemotron response');
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls ?? [],
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          ...(data.usage?.completion_tokens_details?.reasoning_tokens !== undefined
            ? { reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens }
            : {}),
        },
        model: data.model,
        latencyMs: Date.now() - t0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
