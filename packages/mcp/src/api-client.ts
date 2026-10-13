export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly token: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`api ${status}: ${JSON.stringify(body)}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

export class ApiEndpointNotImplemented extends Error {
  readonly body: Record<string, unknown>;

  constructor(body: Record<string, unknown>) {
    super(`api endpoint not implemented: ${body.code ?? 'unknown'}`);
    this.name = 'ApiEndpointNotImplemented';
    this.body = body;
  }
}

export class ApiClient {
  private readonly cfg: ApiClientConfig;

  constructor(cfg: ApiClientConfig) {
    this.cfg = cfg;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.cfg.token}`, accept: 'application/json' },
    });
    if (res.status === 501) {
      throw new ApiEndpointNotImplemented((await res.json()) as Record<string, unknown>);
    }
    if (!res.ok) {
      throw new ApiClientError(res.status, await res.json().catch(() => null));
    }
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 501) {
      throw new ApiEndpointNotImplemented((await res.json()) as Record<string, unknown>);
    }
    if (!res.ok) {
      throw new ApiClientError(res.status, await res.json().catch(() => null));
    }
    return (await res.json()) as T;
  }
}
