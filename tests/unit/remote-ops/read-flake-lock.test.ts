import { describe, it, expect, vi } from 'vitest';
import { readHermesAgentVersion } from '../../../src/remote-ops/read-flake-lock.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function mockSession(stdout: string): SshSession {
  return {
    exec: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 }),
    execStream: vi.fn(),
    execStreamUntil: vi.fn(),
    uploadFile: vi.fn(),
    shell: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SshSession;
}

const FAKE_FLAKE_LOCK = JSON.stringify({
  nodes: {
    'hermes-agent': {
      locked: { lastModified: 1713293605, rev: 'abc123def456789', type: 'github' },
    },
    root: { inputs: { 'hermes-agent': 'hermes-agent' } },
  },
  root: 'root',
  version: 7,
});

describe('readHermesAgentVersion', () => {
  it('extracts rev and date from flake.lock', async () => {
    const session = mockSession(FAKE_FLAKE_LOCK);
    const result = await readHermesAgentVersion(session);
    expect(result).not.toBeNull();
    expect(result!.lockedRev).toBe('abc123def456789');
    expect(result!.lockedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null on SSH error', async () => {
    const session = { exec: vi.fn().mockRejectedValue(new Error('connection lost')) } as unknown as SshSession;
    expect(await readHermesAgentVersion(session)).toBeNull();
  });

  it('returns null when flake.lock has no hermes-agent node', async () => {
    const session = mockSession(JSON.stringify({ nodes: { root: {} }, root: 'root', version: 7 }));
    expect(await readHermesAgentVersion(session)).toBeNull();
  });
});
