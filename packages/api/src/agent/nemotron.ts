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

/**
 * Algunos modelos (y endpoints) devuelven la llamada a una herramienta como
 * TEXTO en `content` en vez de en `tool_calls`:
 *
 *   <tool_call><function=submit_answer><parameter=answer>…</parameter>
 *   <parameter=claims>[{…}]</parameter></function></tool_call>
 *
 * Se leen las llamadas completas. Un parámetro que empieza por `[` o `{` se
 * interpreta como JSON (si no es JSON válido se deja como texto); los demás son
 * cadenas. Una llamada cortada (sin cierre) no se lee: ver `hasTextToolCall`.
 */
export function parseTextToolCalls(content: string | null): { calls: ToolCall[]; rest: string } {
  if (!content?.includes('<tool_call>')) return { calls: [], rest: content ?? '' };
  const calls: ToolCall[] = [];
  const block = /<tool_call>\s*<function=([^>\s]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let rest = content;
  for (const m of content.matchAll(block)) {
    const args: Record<string, unknown> = {};
    for (const p of (m[2] ?? '').matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g)) {
      const raw = (p[2] ?? '').trim();
      let value: unknown = raw;
      if (raw.startsWith('[') || raw.startsWith('{')) {
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw;
        }
      }
      args[p[1] as string] = value;
    }
    calls.push({
      id: `text_call_${calls.length}`,
      type: 'function',
      function: { name: m[1] as string, arguments: JSON.stringify(args) },
    });
    rest = rest.replace(m[0], '');
  }
  return { calls, rest: rest.trim() };
}

/** ¿Queda marcado de llamada a herramienta sin cerrar (respuesta cortada)? */
export function hasTextToolCall(content: string | null): boolean {
  return !!content && (content.includes('<tool_call>') || content.includes('<function='));
}

/** Quita los marcadores de una llamada cortada para que el usuario no lea XML. */
export function stripToolMarkup(content: string): string {
  return content
    .replace(/<\/?tool_call>/g, '')
    .replace(/<\/?function(=[^>]*)?>/g, '')
    .replace(/<\/?parameter(=[^>]*)?>/g, '')
    .trim();
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
      let content = choice.message.content;
      let toolCalls = choice.message.tool_calls ?? [];
      let finishReason = choice.finish_reason;
      if (toolCalls.length === 0) {
        const text = parseTextToolCalls(content);
        if (text.calls.length > 0) {
          toolCalls = text.calls;
          content = text.rest === '' ? null : text.rest;
          finishReason = 'tool_calls';
        }
      }
      return {
        content,
        toolCalls,
        finishReason,
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
