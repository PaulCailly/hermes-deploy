import type { FastifyInstance } from 'fastify';
import {
  secretList,
  secretGet,
  secretSet,
  secretRemove,
} from '../../commands/secret.js';
import { resolveProjectPath } from '../project-resolver.js';

/**
 * Resolve project path with consistent 404 for missing deployments.
 * Returns the path on success, or sends a 404 reply and returns undefined.
 */
async function resolveOrReply404(
  name: string,
  reply: import('fastify').FastifyReply,
): Promise<string | undefined> {
  try {
    return await resolveProjectPath(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    reply.code(404).send({ error: msg });
    return undefined;
  }
}

export async function secretRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/secrets
  app.get<{ Params: { name: string } }>(
    '/api/deployments/:name/secrets',
    async (request, reply) => {
      const projectPath = await resolveOrReply404(request.params.name, reply);
      if (!projectPath) return;

      try {
        const keys = await secretList({ projectPath });
        return { keys };
      } catch (err) {
        console.error('secret list failed:', err);
        reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/deployments/:name/secrets/:key
  app.get<{ Params: { name: string; key: string } }>(
    '/api/deployments/:name/secrets/:key',
    async (request, reply) => {
      const projectPath = await resolveOrReply404(request.params.name, reply);
      if (!projectPath) return;

      try {
        const value = await secretGet({
          key: request.params.key,
          projectPath,
        });
        if (value === undefined) {
          reply.code(404).send({ error: `secret "${request.params.key}" not found` });
          return;
        }
        return { key: request.params.key, value };
      } catch (err) {
        console.error('secret get failed:', err);
        reply.code(500).send({ error: 'Internal server error' });
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

      const projectPath = await resolveOrReply404(request.params.name, reply);
      if (!projectPath) return;

      try {
        await secretSet({
          key: request.params.key,
          value,
          projectPath,
        });
        return { ok: true };
      } catch (err) {
        console.error('secret set failed:', err);
        reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  // DELETE /api/deployments/:name/secrets/:key
  app.delete<{ Params: { name: string; key: string } }>(
    '/api/deployments/:name/secrets/:key',
    async (request, reply) => {
      const projectPath = await resolveOrReply404(request.params.name, reply);
      if (!projectPath) return;

      try {
        await secretRemove({
          key: request.params.key,
          projectPath,
        });
        return { ok: true };
      } catch (err) {
        console.error('secret rm failed:', err);
        reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
