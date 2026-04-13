import type { FastifyInstance } from 'fastify';
import { initCommand } from '../../commands/init.js';

export async function initRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/projects/init
  app.post<{ Body: { dir: string; name?: string } }>(
    '/api/projects/init',
    async (request, reply) => {
      const { dir, name } = request.body ?? {};
      if (!dir) {
        reply.code(400).send({ error: 'dir is required' });
        return;
      }

      try {
        await initCommand({ name, dir });
        return { ok: true, dir, name };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
