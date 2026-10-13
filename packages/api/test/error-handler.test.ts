import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Fastify from 'fastify';
import errorHandler from '../src/plugins/error-handler.js';
import { LainCallError } from '../src/lain-adapter/errors.js';

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
});
