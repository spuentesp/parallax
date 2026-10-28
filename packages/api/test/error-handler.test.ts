import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LainCallError } from '../src/lain-adapter/errors.js';
import errorHandler from '../src/plugins/error-handler.js';

async function makeApp() {
  const app = Fastify();
  await app.register(errorHandler);
  app.get('/zod', async () => {
    z.object({ name: z.string() }).parse({});
    return { ok: true };
  });
  app.get('/notimpl', async () => {
    throw LainCallError.parse({
      code: 'NotImplemented',
      message: 'x',
      doc: 'https://example.com/doc',
    });
  });
  app.get('/lainunavail', async () => {
    throw LainCallError.parse({ code: 'LainUnavailable', message: 'down' });
  });
  app.get('/boom', async () => {
    throw new Error('unexpected');
  });
  app.get('/status/:code', async (req) => {
    const { code } = req.params as { code: string };
    throw Object.assign(new Error(`status ${code}`), { statusCode: Number(code) });
  });
  app.get('/string-status', async () => {
    throw Object.assign(new Error('string status'), { statusCode: '400' });
  });
  return app;
}

describe('error-handler plugin', () => {
  it('maps ZodError to 400 with field list (RFC 7807)', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/zod' });
    expect(r.statusCode).toBe(400);
    expect(r.json().type).toBe('about:blank');
    expect(r.json().title).toBe('Bad Request');
    expect(r.json().errors).toBeInstanceOf(Array);
    await app.close();
  });

  it('maps NotImplemented to 501 with doc field', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/notimpl' });
    expect(r.statusCode).toBe(501);
    expect(r.json().code).toBe('NotImplemented');
    expect(r.json().doc).toBe('https://example.com/doc');
    await app.close();
  });

  it('maps LainUnavailable to 503', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/lainunavail' });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('LainUnavailable');
    await app.close();
  });

  it('maps unknown errors to 500 with traceId', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/boom' });
    expect(r.statusCode).toBe(500);
    expect(r.json().traceId).toMatch(/^[a-z0-9]{8,}$/);
    await app.close();
  });

  it('passes a client error status through with its own title and detail', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/status/415' });
    expect(r.statusCode).toBe(415);
    expect(r.json()).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 415,
      detail: 'status 415',
      traceId: expect.any(String),
    });
    await app.close();
  });

  it('covers the whole 4xx range, both ends included', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/status/400' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/status/499' })).statusCode).toBe(499);
    await app.close();
  });

  it('turns a 5xx status into the generic 500, not the error status', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/status/503' });
    expect(r.statusCode).toBe(500);
    expect(r.json().title).toBe('Internal Server Error');
    expect(r.json().detail).toBe('unexpected error');
    await app.close();
  });

  it('ignores a status that is not a number', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/string-status' });
    expect(r.statusCode).toBe(500);
    await app.close();
  });

  it('answers a 500 status with the generic 500 body, not a client error', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/status/500' });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toMatchObject({ title: 'Internal Server Error', detail: 'unexpected error' });
    await app.close();
  });

  it('answers a plain error with the generic 500 body', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/boom' });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toMatchObject({ title: 'Internal Server Error', detail: 'unexpected error' });
    await app.close();
  });

  it('does not pass a numeric status below the 4xx range through', async () => {
    const app = await makeApp();
    for (const code of ['302', '399']) {
      const r = await app.inject({ method: 'GET', url: `/status/${code}` });
      expect(r.statusCode).toBe(500);
      expect(r.json().title).toBe('Internal Server Error');
    }
    await app.close();
  });
});
