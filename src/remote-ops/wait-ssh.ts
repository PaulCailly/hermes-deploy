import { createConnection } from 'node:net';

export interface WaitForSshOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
}

export async function waitForSshPort(opts: WaitForSshOptions): Promise<void> {
  const port = opts.port ?? 22;
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  const backoffSeq = [1000, 2000, 4000, 8000, 8000];
  let attempt = 0;

  while (Date.now() < deadline) {
    const ok = await tryConnect(opts.host, port);
    if (ok) return;
    const wait = backoffSeq[Math.min(attempt, backoffSeq.length - 1)]!;
    attempt++;
    await sleep(wait);
  }
  throw new Error(`timeout waiting for ${opts.host}:${port}`);
}

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port, timeout: 2000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
