import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  map: 'application/json',
};

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export const webRoutes: FastifyPluginAsync = async (app) => {
  const root = resolve(app.config.webBundlePath);

  // Serve static assets (JS, CSS, images).
  app.get('/assets/*', { config: { public: true } }, async (req, reply) => {
    const wildcard = (req.params as { '*': string })['*'] ?? '';
    const requested = normalize(wildcard).replace(/^[/\\]+/, '');
    const abs = resolve(root, 'assets', requested);
    if (!abs.startsWith(resolve(root, 'assets') + sep)) {
      return reply.code(400).send({ type: 'about:blank', title: 'Bad Request', status: 400 });
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return reply.code(404).send({ type: 'about:blank', title: 'Not Found', status: 404 });
    }
    return reply.header('content-type', mimeFor(abs)).send(readFileSync(abs));
  });

  // SPA fallback: any non-API, non-asset URL serves index.html.
  app.setNotFoundHandler((req, reply) => {
    const url = req.url;
    const isApi = url.startsWith('/api/') || url.startsWith('/mcp');
    if (isApi) {
      return reply.code(404).send({ type: 'about:blank', title: 'Not Found', status: 404 });
    }
    const indexPath = join(root, 'index.html');
    if (!existsSync(indexPath)) {
      return reply.code(404).send({
        code: 'WebBundleNotBuilt',
        message: 'run `pnpm --filter @parallax/web build` first',
        doc: 'https://github.com/spuentesp/parallax#run-dev-mode',
      });
    }
    return reply.header('content-type', 'text/html; charset=utf-8').send(readFileSync(indexPath));
  });
};
