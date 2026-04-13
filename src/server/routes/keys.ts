import type { FastifyInstance } from 'fastify';
import { keyExport, keyImport, keyPath } from '../../commands/key.js';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/keys/path
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/keys/path',
    async (request, reply) => {
      try {
        const path = await keyPath({ name: request.params.name });
        return { name: request.params.name, path };
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes('no age key for deployment')) {
          reply.code(404).send({ error: msg });
        } else {
          reply.code(500).send({ error: msg });
        }
      }
    },
  );

  // GET /api/deployments/:name/keys/export
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/keys/export',
    async (request, reply) => {
      try {
        const content = await keyExport({ name: request.params.name });
        reply.type('text/plain').send(content);
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes('no age key for deployment')) {
          reply.code(404).send({ error: msg });
        } else {
          reply.code(500).send({ error: msg });
        }
      }
    },
  );

  // POST /api/deployments/:name/keys/import
  app.post<{ Params: { name: string }; Body: { path: string } }>(
    '/api/deployments/:name/keys/import',
    async (request, reply) => {
      const { path } = request.body ?? {};
      if (!path?.trim()) {
        reply.code(400).send({ error: 'path is required' });
        return;
      }
      try {
        const destPath = await keyImport({ name: request.params.name, path: path.trim() });
        return { name: request.params.name, path: destPath };
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes('already exists')) {
          reply.code(409).send({ error: msg });
        } else if (msg.includes('does not exist')) {
          reply.code(404).send({ error: msg });
        } else {
          reply.code(500).send({ error: msg });
        }
      }
    },
  );
}
