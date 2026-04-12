import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export async function registerStatic(app: FastifyInstance, webDistDir: string): Promise<void> {
  if (!existsSync(webDistDir)) {
    // In dev mode, the web bundle may not be built yet — skip static serving.
    // The Vite dev server will proxy API requests to us.
    return;
  }

  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: serve index.html for any non-API, non-WS route
  // that doesn't match a static file.
  const indexHtml = join(webDistDir, 'index.html');
  app.setNotFoundHandler((request, reply) => {
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/ws/') ||
      request.url === '/healthz'
    ) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    if (existsSync(indexHtml)) {
      const html = readFileSync(indexHtml, 'utf-8');
      reply.type('text/html').send(html);
    } else {
      reply.code(404).send({ error: 'dashboard not built — run npm run build:web' });
    }
  });
}
