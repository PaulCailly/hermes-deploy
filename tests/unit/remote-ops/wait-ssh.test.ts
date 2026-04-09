import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { waitForSshPort } from '../../../src/remote-ops/wait-ssh.js';

describe('waitForSshPort', () => {
  it('resolves once the port is reachable', async () => {
    const server = createServer().listen(0);
    await new Promise<void>(r => server.once('listening', () => r()));
    const port = (server.address() as any).port;
    await expect(
      waitForSshPort({ host: '127.0.0.1', port, timeoutMs: 2000 }),
    ).resolves.toBeUndefined();
    server.close();
  });

  it('rejects after the timeout if the port stays closed', async () => {
    await expect(
      waitForSshPort({ host: '127.0.0.1', port: 1, timeoutMs: 500 }),
    ).rejects.toThrow(/timeout/);
  });
});
