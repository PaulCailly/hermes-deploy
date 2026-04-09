import { describe, it, expect, vi } from 'vitest';
import { runNixosRebuild } from '../../../src/remote-ops/nixos-rebuild.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function makeFakeSession(exitCode: number, lines: Array<[string, string]> = []) {
  const fake: Partial<SshSession> = {
    execStream: vi.fn(async (_cmd, onLine) => {
      for (const [s, l] of lines) onLine(s as any, l);
      return { exitCode, stdout: lines.map(l => l[1]).join('\n'), stderr: '' };
    }),
  };
  return fake as SshSession;
}

describe('runNixosRebuild', () => {
  it('returns success on exit code 0', async () => {
    const session = makeFakeSession(0, [['stdout', 'building...'], ['stdout', 'done']]);
    const result = await runNixosRebuild(session, () => {});
    expect(result.success).toBe(true);
  });

  it('returns failure on non-zero exit and captures the tail', async () => {
    const lines: Array<[string, string]> = [];
    for (let i = 0; i < 60; i++) lines.push(['stdout', `line ${i}`]);
    lines.push(['stderr', 'error: build failed']);
    const session = makeFakeSession(1, lines);
    const result = await runNixosRebuild(session, () => {});
    expect(result.success).toBe(false);
    expect(result.tail.length).toBeLessThanOrEqual(50);
    expect(result.tail.join('\n')).toContain('error: build failed');
  });
});
