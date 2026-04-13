import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';
import { createSshSession } from '../../remote-ops/session.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // WS /ws/logs/:name — stream journalctl -f
  app.get<{ Params: { name: string } }>(
    '/ws/logs/:name',
    { websocket: true },
    async (socket, request) => {
      const { name } = request.params;
      const store = new StateStore(getStatePaths());
      const state = await store.read();
      const deployment = state.deployments[name];

      if (!deployment) {
        socket.close(4004, `deployment "${name}" not found`);
        return;
      }

      let session;
      try {
        const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
        session = await createSshSession({
          host: deployment.instance_ip,
          username: 'root',
          privateKey,
        });
      } catch (err) {
        socket.send(JSON.stringify({ stream: 'stderr', line: `SSH connection failed: ${(err as Error).message}` }));
        socket.close(4005, 'ssh connection failed');
        return;
      }

      const controller = new AbortController();

      socket.on('close', () => {
        controller.abort();
        session?.dispose().catch(() => {});
      });

      socket.on('error', () => {
        controller.abort();
        session?.dispose().catch(() => {});
      });

      try {
        await session.execStreamUntil(
          'journalctl -u hermes-agent.service -f --no-pager -n 200',
          controller.signal,
          (stream, line) => {
            try {
              socket.send(JSON.stringify({ stream, line }));
            } catch {
              // client disconnected
              controller.abort();
            }
          },
        );
      } catch {
        // stream ended or aborted
      } finally {
        await session.dispose().catch(() => {});
        try { socket.close(); } catch { /* already closed */ }
      }
    },
  );
}
