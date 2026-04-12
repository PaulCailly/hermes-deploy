import type { FastifyInstance } from 'fastify';
import type { ReporterBus } from '../reporter-bus.js';

export async function jobRoutes(app: FastifyInstance, bus: ReporterBus): Promise<void> {
  // GET /api/jobs/:jobId — snapshot of job state
  app.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId',
    async (request, reply) => {
      const job = bus.getJob(request.params.jobId);
      if (!job) {
        reply.code(404).send({ error: 'job not found' });
        return;
      }
      return job;
    },
  );

  // WS /ws/jobs/:jobId — live event stream
  app.get<{ Params: { jobId: string } }>(
    '/ws/jobs/:jobId',
    { websocket: true },
    (socket, request) => {
      const subscribed = bus.subscribe(request.params.jobId, socket);
      if (!subscribed) {
        socket.close(4004, 'job not found');
      }
    },
  );
}
