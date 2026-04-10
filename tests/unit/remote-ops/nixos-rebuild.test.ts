import { describe, it, expect, vi } from 'vitest';
import { runNixosRebuild } from '../../../src/remote-ops/nixos-rebuild.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

/**
 * The nohup+poll rebuild uses exec (not execStream) for both starting
 * the background job and polling. The mock session simulates:
 *   - First exec: starts the nohup rebuild (returns immediately)
 *   - Poll execs: wc -l returns line count, sed returns log lines,
 *     cat exit-file returns the exit code once "done"
 */
function makeFakeSessionFactory(exitCode: number, logLines: string[] = []) {
  let callCount = 0;
  const logContent = logLines.join('\n') + (logLines.length ? '\n' : '');

  const fakeSession: SshSession = {
    exec: vi.fn(async (cmd: string) => {
      callCount++;
      // nohup start command
      if (cmd.includes('nohup')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      // cat exit file — return empty first time (still building), then the exit code
      if (cmd.includes('hermes-rebuild.exit')) {
        if (callCount <= 2) return { exitCode: 0, stdout: '', stderr: '' };
        return { exitCode: 0, stdout: String(exitCode), stderr: '' };
      }
      // wc -l log file
      if (cmd.includes('wc -l')) {
        return { exitCode: 0, stdout: String(logLines.length), stderr: '' };
      }
      // sed log lines
      if (cmd.includes('sed')) {
        return { exitCode: 0, stdout: logContent, stderr: '' };
      }
      // rm cleanup
      if (cmd.includes('rm -f')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    execStreamUntil: vi.fn(async () => ({ aborted: false, exitCode: 0 })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };

  return async () => fakeSession;
}

describe('runNixosRebuild', () => {
  it('returns success on exit code 0', async () => {
    const factory = makeFakeSessionFactory(0, ['building...', 'done']);
    const result = await runNixosRebuild(factory, () => {}, { pollIntervalMs: 10 });
    expect(result.success).toBe(true);
  });

  it('returns failure on non-zero exit and captures the tail', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) lines.push(`line ${i}`);
    lines.push('error: build failed');
    const factory = makeFakeSessionFactory(1, lines);
    const result = await runNixosRebuild(factory, () => {}, { pollIntervalMs: 10 });
    expect(result.success).toBe(false);
    expect(result.tail.length).toBeLessThanOrEqual(50);
    expect(result.tail.join('\n')).toContain('error: build failed');
  });
});
