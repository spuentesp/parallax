import type { FastifyPluginAsync } from 'fastify';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

const DOC = 'https://github.com/spuentesp/parallax#run-dev-mode';

export const appRoutes: FastifyPluginAsync = async (fastify) => {
  const root = resolve(fastify.config.webBundlePath);

  fastify.get('/app/*', async (req, reply) => {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      return reply.code(404).send({
        code: 'WebBundleNotBuilt',
        message: 'web bundle not built; run `pnpm --filter @parallax/web build` and restart the api',
        doc: DOC,
      });
    }
    const wildcard = (req.params as { '*': string })['*'] ?? '';
    // Reject path traversal: resolve and ensure the result stays inside root.
    const requested = normalize(wildcard).replace(/^[/\\]+/, '');
    const abs = resolve(root, requested);
    if (!abs.startsWith(root + sep) && abs !== root) {
      return reply
        .code(400)
        .send({ type: 'about:blank', title: 'Bad Request', status: 400 });
    }
    const filePath = join(root, requested || 'index.html');
    // SPA fallback: if the exact file doesn't exist, serve index.html.
    const targetPath = existsSync(filePath) ? filePath : join(root, 'index.html');
    if (!existsSync(targetPath)) {
      return reply.code(404).send({
        code: 'WebBundleNotBuilt',
        message: 'web bundle not built or file missing',
        doc: DOC,
      });
    }
    const content = readFileSync(targetPath);
    const ext = targetPath.split('.').pop()?.toLowerCase();
    const contentType =
      ext === 'html'
        ? 'text/html; charset=utf-8'
        : ext === 'js' || ext === 'mjs'
          ? 'text/javascript; charset=utf-8'
          : ext === 'css'
            ? 'text/css; charset=utf-8'
            : ext === 'json'
              ? 'application/json'
              : ext === 'svg'
                ? 'image/svg+xml'
                : ext === 'png'
                  ? 'image/png'
                  : ext === 'ico'
                    ? 'image/x-icon'
                    : 'application/octet-stream';
    return reply.header('content-type', contentType).send(content);
  });

  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/app/') || req.url === '/app') {
      if (existsSync(join(root, 'index.html'))) {
        const content = readFileSync(join(root, 'index.html'));
        return reply.header('content-type', 'text/html; charset=utf-8').send(content);
      }
      return reply.code(404).send({
        code: 'WebBundleNotBuilt',
        message: 'web bundle not built',
        doc: DOC,
      });
    }
    return reply
      .code(404)
      .send({ type: 'about:blank', title: 'Not Found', status: 404 });
  });
};
