import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError, ApiEndpointNotImplemented } from '../src/api-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiClient', () => {
  it('GET returns the parsed body and sends the bearer token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { orgs: [] }));
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    await expect(c.get('/orgs')).resolves.toEqual({ orgs: [] });
    expect(fetchSpy).toHaveBeenCalledWith('http://api/orgs', {
      headers: { authorization: 'Bearer t', accept: 'application/json' },
    });
  });

  it('POST serializes the body with JSON headers', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(201, { created: true }));
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    await expect(c.post('/assessments', { orgId: 'acme' })).resolves.toEqual({ created: true });
    expect(fetchSpy).toHaveBeenCalledWith('http://api/assessments', {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{"orgId":"acme"}',
    });
  });

  it('GET 501 raises ApiEndpointNotImplemented carrying the api body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(501, { code: 'NotImplemented', message: 'x' }),
    );
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiEndpointNotImplemented);
    expect((err as ApiEndpointNotImplemented).body).toEqual({
      code: 'NotImplemented',
      message: 'x',
    });
  });

  it('POST 501 raises ApiEndpointNotImplemented too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(501, { code: 'NotImplemented' }),
    );
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.post('/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiEndpointNotImplemented);
    expect((err as ApiEndpointNotImplemented).body).toEqual({ code: 'NotImplemented' });
  });

  it('non-ok responses raise ApiClientError with status, body and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(500, { boom: true }));
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(500);
    expect((err as ApiClientError).body).toEqual({ boom: true });
    expect((err as ApiClientError).message).toBe('api 500: {"boom":true}');
    expect((err as ApiClientError).name).toBe('ApiClientError');
  });

  it('non-JSON error bodies degrade to null instead of masking the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not json', { status: 502 }));
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.get('/x').catch((e: unknown) => e);
    expect((err as ApiClientError).status).toBe(502);
    expect((err as ApiClientError).body).toBeNull();
  });

  it('POST non-ok raises ApiClientError and a non-JSON body degrades to null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not json', { status: 400 }));
    const c = new ApiClient({ baseUrl: 'http://api', token: 't' });
    const err = await c.post('/assessments', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(400);
    expect((err as ApiClientError).body).toBeNull();
  });

  it('ApiEndpointNotImplemented names the code, or unknown when the body has none', () => {
    const withCode = new ApiEndpointNotImplemented({ code: 'NotImplemented' });
    expect(withCode.message).toBe('api endpoint not implemented: NotImplemented');
    expect(withCode.name).toBe('ApiEndpointNotImplemented');
    const withoutCode = new ApiEndpointNotImplemented({});
    expect(withoutCode.message).toBe('api endpoint not implemented: unknown');
  });
});
