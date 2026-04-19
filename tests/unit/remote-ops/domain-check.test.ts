import { describe, it, expect, vi } from 'vitest';
import { runRemoteDomainChecks } from '../../../src/remote-ops/domain-check.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeSession(
  responses: Record<string, { exitCode: number; stdout: string; stderr: string }>,
): SshSession {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(responses)) {
        if (cmd.includes(pattern)) return result;
      }
      return { exitCode: 1, stdout: '', stderr: 'unknown command' };
    }),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    execStreamUntil: vi.fn(async () => ({ aborted: false, exitCode: 0 })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runRemoteDomainChecks', () => {
  it('returns all-ok when nginx is active and upstream responds', async () => {
    const session = fakeSession({
      'systemctl is-active nginx': { exitCode: 0, stdout: 'active\n', stderr: '' },
      'nginx -t': { exitCode: 0, stdout: '', stderr: 'syntax is ok' },
      '/var/lib/acme': { exitCode: 0, stdout: 'Dec 31 23:59:59 2026 GMT\n', stderr: '' },
      'curl': { exitCode: 0, stdout: '200', stderr: '' },
    });
    const result = await runRemoteDomainChecks(session, 'jarvis.backresto.com', 3000);
    expect(result.nginx.active).toBe(true);
    expect(result.nginx.configValid).toBe(true);
    expect(result.nginx.ok).toBe(true);
    expect(result.tls.ok).toBe(true);
    expect(result.tls.daysRemaining).toBeGreaterThan(0);
    expect(result.upstream.ok).toBe(true);
    expect(result.upstream.httpStatus).toBe(200);
  });

  it('returns nginx inactive when systemctl fails', async () => {
    const session = fakeSession({
      'systemctl is-active nginx': { exitCode: 3, stdout: 'inactive\n', stderr: '' },
      'nginx -t': { exitCode: 1, stdout: '', stderr: 'error' },
      '/var/lib/acme': { exitCode: 1, stdout: '', stderr: '' },
      'curl': { exitCode: 7, stdout: '', stderr: '' },
    });
    const result = await runRemoteDomainChecks(session, 'test.example.com', 3000);
    expect(result.nginx.active).toBe(false);
    expect(result.nginx.ok).toBe(false);
    expect(result.tls.ok).toBe(false);
    expect(result.upstream.ok).toBe(false);
  });
});
