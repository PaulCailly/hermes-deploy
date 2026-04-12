import type { FastifyInstance } from 'fastify';
import {
  secretList,
  secretGet,
  secretSet,
  secretRemove,
} from '../../commands/secret.js';
import { resolveProjectPath } from '../project-resolver.js';

export async function secretRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/secrets
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/secrets',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const keys = await secretList({ name: request.params.name, projectPath });
        return { keys };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  // GET /api/deployments/:name/secrets/:key
  app.get<{ Params: { name: string; key: string } }>(
    '/api/deployments/:name/secrets/:key',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const value = await secretGet({
          key: request.params.key,
          name: request.params.name,
          projectPath,
        });
        if (value === undefined) {
          reply.code(404).send({ error: `secret "${request.params.key}" not found` });
          return;
        }
        return { key: request.params.key, value };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  // PUT /api/deployments/:name/secrets/:key
  app.put<{ Params: { name: string; key: string }; Body: { value: string } }>(
    '/api/deployments/:name/secrets/:key',
    async (request, reply) => {
      const { value } = request.body ?? {};
      if (typeof value !== 'string') {
        reply.code(400).send({ error: 'value is required' });
        return;
      }

      try {
        const projectPath = await resolveProjectPath(request.params.name);
        await secretSet({
          key: request.params.key,
          value,
          name: request.params.name,
          projectPath,
        });
        return { ok: true };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  // DELETE /api/deployments/:name/secrets/:key
  app.delete<{ Params: { name: string; key: string } }>(
    '/api/deployments/:name/secrets/:key',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        await secretRemove({
          key: request.params.key,
          name: request.params.name,
          projectPath,
        });
        return { ok: true };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
