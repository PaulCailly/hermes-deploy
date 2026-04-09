import { describe, it, expect, vi } from 'vitest';
import { createSshSession } from '../../../src/remote-ops/session.js';

// We test the *interface* — the actual ssh2 connection happens against a real
// box during smoke tests. Here we use a mock Client.
class FakeStream {
  private listeners: Record<string, Array<(arg: any) => void>> = {};
  on(ev: string, cb: (arg: any) => void) {
    (this.listeners[ev] ||= []).push(cb);
    return this;
  }
  emit(ev: string, arg?: any) {
    for (const cb of this.listeners[ev] ?? []) cb(arg);
  }
  stderr = { on: (_e: string, _cb: any) => this };
}

class FakeClient {
  on = vi.fn();
  exec = vi.fn();
  end = vi.fn();
  connect = vi.fn();
}

describe('createSshSession', () => {
  it('runs a command and resolves with stdout', async () => {
    const fake = new FakeClient();
    const stream = new FakeStream();
    fake.exec.mockImplementation((_cmd: string, cb: any) => {
      cb(null, stream);
      setTimeout(() => {
        stream.emit('data', Buffer.from('hello'));
        stream.emit('close', 0);
      }, 5);
    });
    fake.on.mockImplementation((ev: string, cb: any) => {
      if (ev === 'ready') setTimeout(cb, 5);
      return fake;
    });

    const session = await createSshSession(
      { host: 'x', username: 'root', privateKey: 'key', port: 22 },
      fake as any,
    );
    const result = await session.exec('echo hello');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    await session.dispose();
    expect(fake.end).toHaveBeenCalled();
  });
});
