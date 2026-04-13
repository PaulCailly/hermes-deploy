import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';
import { createSshSession } from '../../remote-ops/session.js';
import type { SshSession } from '../../remote-ops/session.js';

export async function sshRoutes(app: FastifyInstance): Promise<void> {
  // WS /ws/ssh/:name — interactive PTY shell
  app.get<{ Params: { name: string } }>(
    '/ws/ssh/:name',
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

      let session: SshSession;
      try {
        const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
        session = await createSshSession({
          host: deployment.instance_ip,
          username: 'root',
          privateKey,
        });
      } catch (err) {
        socket.send(JSON.stringify({ error: `SSH connection failed: ${(err as Error).message}` }));
        socket.close(4005, 'ssh connection failed');
        return;
      }

      if (!session.shell) {
        socket.send(JSON.stringify({ error: 'shell not supported' }));
        socket.close(4006, 'shell not supported');
        await session.dispose();
        return;
      }

      let shellHandle;
      try {
        shellHandle = await session.shell({ term: 'xterm-256color', cols: 80, rows: 24 });
      } catch (err) {
        socket.send(JSON.stringify({ error: `Failed to open shell: ${(err as Error).message}` }));
        socket.close(4007, 'shell open failed');
        await session.dispose();
        return;
      }

      // Guard against multiple dispose calls
      let disposed = false;
      const safeDispose = () => {
        if (disposed) return;
        disposed = true;
        session.dispose().catch(() => {});
      };

      // Pipe shell stdout → WS (binary frames)
      shellHandle.onData((data) => {
        try {
          socket.send(data);
        } catch {
          // client gone
        }
      });

      shellHandle.onClose(() => {
        try { socket.close(); } catch { /* */ }
        safeDispose();
      });

      // WS → shell stdin
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        // Normalize incoming data to Buffer
        let buf: Buffer;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else if (Array.isArray(data)) {
          buf = Buffer.concat(data);
        } else {
          buf = Buffer.from(data as any);
        }

        if (!isBinary) {
          const str = buf.toString();
          try {
            const msg = JSON.parse(str);
            if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
              shellHandle.resize(msg.cols, msg.rows);
              return;
            }
          } catch {
            // Not JSON — treat as terminal input
          }
          shellHandle.write(str);
        } else {
          shellHandle.write(buf);
        }
      });

      socket.on('close', () => {
        shellHandle.close();
        safeDispose();
      });

      socket.on('error', () => {
        shellHandle.close();
        safeDispose();
      });
    },
  );
}
