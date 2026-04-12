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
        // initCommand uses process.cwd() by default — we override by
        // changing to the target dir temporarily.
        const originalCwd = process.cwd();
        try {
          process.chdir(dir);
          await initCommand({ name });
        } finally {
          process.chdir(originalCwd);
        }
        return { ok: true, dir, name };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
