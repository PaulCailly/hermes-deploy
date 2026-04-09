import { describe, it, expect, vi } from 'vitest';
import { pollHermesHealth } from '../../../src/remote-ops/healthcheck.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeSession(responses: Array<{ exitCode: number; stdout: string }>) {
  let i = 0;
  const fake: Partial<SshSession> = {
    exec: vi.fn(async () => {
      const r = responses[i++] ?? responses[responses.length - 1]!;
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: '' };
    }),
  };
  return fake as SshSession;
}

describe('pollHermesHealth', () => {
  it('returns healthy when systemctl is-active returns active immediately', async () => {
    const session = fakeSession([{ exitCode: 0, stdout: 'active' }]);
    const result = await pollHermesHealth(session, { intervalMs: 10, timeoutMs: 1000 });
    expect(result.health).toBe('healthy');
  });

  it('returns unhealthy with journal tail when never active within timeout', async () => {
    const session = fakeSession([
      { exitCode: 3, stdout: 'activating' },
      { exitCode: 3, stdout: 'failed' },
      { exitCode: 0, stdout: 'line 1\nline 2\nline 3' }, // journalctl call
    ]);
    const result = await pollHermesHealth(session, { intervalMs: 10, timeoutMs: 50 });
    expect(result.health).toBe('unhealthy');
    expect(result.journalTail.length).toBeGreaterThan(0);
  });
});
