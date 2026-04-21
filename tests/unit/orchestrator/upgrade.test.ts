import { describe, it, expect, vi } from 'vitest';
import { runUpgrade } from '../../../src/orchestrator/upgrade.js';
import type { SshSession } from '../../../src/remote-ops/session.js';
import type { Reporter } from '../../../src/orchestrator/reporter.js';

function stubReporter(): Reporter {
  return {
    phaseStart: vi.fn(), phaseDone: vi.fn(), phaseFail: vi.fn(),
    log: vi.fn(), success: vi.fn(),
  };
}

function stubSession(execImpl?: (cmd: string) => any): SshSession {
  const defaultExec = (cmd: string) => {
    if (cmd.includes('cat /etc/nixos/flake.lock')) {
      return Promise.resolve({
        stdout: JSON.stringify({
          nodes: { 'hermes-agent': { locked: { rev: 'newrev123', lastModified: 1713300000 } }, root: {} },
          root: 'root', version: 7,
        }),
        stderr: '', exitCode: 0,
      });
    }
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  };
  return {
    exec: vi.fn().mockImplementation(execImpl ?? defaultExec),
    dispose: vi.fn().mockResolvedValue(undefined),
    execStream: vi.fn(), execStreamUntil: vi.fn(),
    uploadFile: vi.fn(), shell: vi.fn(),
  } as unknown as SshSession;
}

describe('runUpgrade', () => {
  it('runs all phases and persists the new rev', async () => {
    const reporter = stubReporter();
    const stateUpdater = vi.fn().mockResolvedValue(undefined);
    await runUpgrade({
      deploymentName: 'test',
      sessionFactory: async () => stubSession(),
      nixosRebuildRunner: vi.fn().mockResolvedValue({ success: true, tail: [] }),
      healthchecker: vi.fn().mockResolvedValue({ health: 'healthy', journalTail: [] }),
      stateUpdater,
      reporter,
    });
    expect(reporter.phaseStart).toHaveBeenCalledWith('flake-update', expect.any(String));
    expect(reporter.phaseStart).toHaveBeenCalledWith('bootstrap', expect.any(String));
    expect(reporter.phaseStart).toHaveBeenCalledWith('healthcheck', expect.any(String));
    expect(reporter.success).toHaveBeenCalled();
    expect(stateUpdater).toHaveBeenCalledWith('newrev123', '');
  });

  it('throws on flake update failure', async () => {
    const session = stubSession(() => Promise.resolve({ stdout: '', stderr: 'error', exitCode: 1 }));
    const reporter = stubReporter();
    await expect(runUpgrade({
      deploymentName: 'test',
      sessionFactory: async () => session,
      nixosRebuildRunner: vi.fn(),
      healthchecker: vi.fn(),
      stateUpdater: vi.fn(),
      reporter,
    })).rejects.toThrow(/nix flake update failed/);
    expect(reporter.phaseFail).toHaveBeenCalled();
  });

  it('throws on rebuild failure', async () => {
    const reporter = stubReporter();
    await expect(runUpgrade({
      deploymentName: 'test',
      sessionFactory: async () => stubSession(),
      nixosRebuildRunner: vi.fn().mockResolvedValue({ success: false, tail: ['error line'] }),
      healthchecker: vi.fn(),
      stateUpdater: vi.fn(),
      reporter,
    })).rejects.toThrow(/nixos-rebuild failed/);
  });

  it('throws on unhealthy service after upgrade', async () => {
    const reporter = stubReporter();
    await expect(runUpgrade({
      deploymentName: 'test',
      sessionFactory: async () => stubSession(),
      nixosRebuildRunner: vi.fn().mockResolvedValue({ success: true, tail: [] }),
      healthchecker: vi.fn().mockResolvedValue({ health: 'unhealthy', journalTail: ['failed'] }),
      stateUpdater: vi.fn(),
      reporter,
    })).rejects.toThrow(/unhealthy/);
  });
});
