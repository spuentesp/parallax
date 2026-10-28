export interface ApiClientConfig {
  readonly baseUrl?: string;
  /** Valor fijo o función: la sesión puede cambiar de token sin recrear el cliente. */
  readonly token?: string | (() => string | undefined);
}

export class ApiEndpointNotImplemented extends Error {
  readonly body: Record<string, unknown>;

  constructor(body: Record<string, unknown>) {
    super(`api endpoint not implemented: ${body.code ?? 'unknown'}`);
    this.name = 'ApiEndpointNotImplemented';
    this.body = body;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`api ${status}: ${JSON.stringify(body)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | (() => string | undefined) | undefined;

  constructor(cfg: ApiClientConfig = {}) {
    this.baseUrl = cfg.baseUrl ?? '';
    this.token = cfg.token;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json', ...extra };
    const token = typeof this.token === 'function' ? this.token() : this.token;
    if (token) h.authorization = `Bearer ${token}`;
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (res.status === 501) {
      throw new ApiEndpointNotImplemented((await res.json()) as Record<string, unknown>);
    }
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PUT', path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body);
  }

  async del<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return (await res.json()) as T;
  }

  /**
   * POST que responde con server-sent events. `onEvent` recibe cada evento a medida que
   * llega; devuelve el dato del evento `result`. Devuelve null si el servidor no ofrece
   * el flujo (404 o una respuesta que no es un flujo): el llamador usa la ruta normal.
   */
  async postSse<T>(
    path: string,
    body: unknown,
    onEvent: (event: string, data: unknown) => void,
  ): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
      body: JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 405) return null;
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream') || !res.body) {
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | undefined;
    let failure: unknown;
    const dispatch = (block: string): void => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) return;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (event === 'result') result = data as T;
      else if (event === 'error') failure = data;
      else onEvent(event, data);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let at = buffer.indexOf('\n\n');
      while (at >= 0) {
        dispatch(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
        at = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) dispatch(buffer);
    if (failure !== undefined) throw new ApiError(500, failure);
    if (result === undefined)
      throw new ApiError(502, { detail: 'the stream ended without a result' });
    return result;
  }

  private async send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (res.status === 501) {
      throw new ApiEndpointNotImplemented((await res.json()) as Record<string, unknown>);
    }
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return (await res.json()) as T;
  }
}
