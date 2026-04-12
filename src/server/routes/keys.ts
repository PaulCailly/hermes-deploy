import type { FastifyInstance } from 'fastify';
import { keyExport, keyImport, keyPath } from '../../commands/key.js';

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/keys/path
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/keys/path',
    async (request, reply) => {
      try {
        const path = await keyPath({ name: request.params.name });
        return { name: request.params.name, path };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
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
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // POST /api/deployments/:name/keys/import
  app.post<{ Params: { name: string }; Body: { path: string } }>(
    '/api/deployments/:name/keys/import',
    async (request, reply) => {
      const { path } = request.body ?? {};
      if (!path) {
        reply.code(400).send({ error: 'path is required' });
        return;
      }
      try {
        const destPath = await keyImport({ name: request.params.name, path });
        return { name: request.params.name, path: destPath };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
