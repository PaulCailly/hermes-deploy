import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const statusMock = vi.fn();

vi.mock('../../../src/cloud/factory.js', () => ({
  createCloudProvider: () => ({
    name: 'aws' as const,
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(),
    destroy: vi.fn(),
    status: statusMock,
    adopt: vi.fn(),
  }),
}));

import { statusCommand } from '../../../src/commands/status.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

describe('statusCommand', () => {
  let configDir: string;
  let origStdoutWrite: typeof process.stdout.write;
  let origConsoleLog: typeof console.log;
  let lastStdout: string;
  let consoleLines: string[];

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-status-'));
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;
    lastStdout = '';
    consoleLines = [];
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    origConsoleLog = console.log.bind(console);
    process.stdout.write = ((chunk: unknown): boolean => {
      lastStdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]): void => {
      consoleLines.push(args.map(String).join(' '));
    };

    // Seed a deployment in state
    const store = new StateStore(getStatePaths());
    await store.update((state) => {
      state.deployments['demo'] = {
        project_path: '/tmp/demo',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-09T10:00:00Z',
        last_deployed_at: '2026-04-09T11:00:00Z',
        last_config_hash: 'sha256:abc',
        last_nix_hash: 'sha256:def',
        ssh_key_path: '/tmp/ssh',
        age_key_path: '/tmp/age',
        health: 'healthy',
        instance_ip: '203.0.113.1',
        cloud_resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eip-1',
          region: 'eu-west-3',
        },
      };
    });

    statusMock.mockReset();
    statusMock.mockResolvedValue({
      state: 'running',
      publicIp: '203.0.113.1',
    });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    process.stdout.write = origStdoutWrite;
    console.log = origConsoleLog;
  });

  it('emits JSON when json:true', async () => {
    await statusCommand({ name: 'demo', json: true });
    const parsed = JSON.parse(lastStdout);
    expect(parsed.name).toBe('demo');
    expect(parsed.found).toBe(true);
    expect(parsed.stored.cloud).toBe('aws');
    expect(parsed.stored.health).toBe('healthy');
    expect(parsed.stored.last_config_hash).toBe('sha256:abc');
    expect(parsed.live.state).toBe('running');
    expect(parsed.live.publicIp).toBe('203.0.113.1');
  });

  it('emits human-formatted text when json is false', async () => {
    await statusCommand({ name: 'demo' });
    expect(lastStdout).toBe(''); // nothing on process.stdout.write
    const combined = consoleLines.join('\n');
    expect(combined).toContain('Deployment:');
    expect(combined).toContain('demo');
    expect(combined).toContain('running');
  });

});
