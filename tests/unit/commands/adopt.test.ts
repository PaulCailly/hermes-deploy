import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stub the cloud factory so the adopt integration test doesn't hit
// real cloud APIs. The stub lets us control what `provider.adopt()`
// returns for each test case.
const adoptMock = vi.fn();
vi.mock('../../../src/cloud/factory.js', () => ({
  createCloudProvider: () => ({
    name: 'aws' as const,
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn(),
    adopt: adoptMock,
  }),
}));

import { adoptDeployment } from '../../../src/commands/adopt.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

function writeMinimalHermesToml(dir: string, name: string): void {
  writeFileSync(
    join(dir, 'hermes.toml'),
    [
      `name = "${name}"`,
      '',
      '[cloud]',
      'provider = "aws"',
      'profile = "default"',
      'region = "eu-west-3"',
      'size = "small"',
      '',
      '[network]',
      'ssh_allowed_from = "auto"',
      'inbound_ports = []',
      '',
      '[hermes]',
      'config_file = "./config.yaml"',
      'secrets_file = "./secrets.env.enc"',
      '',
      '[hermes.documents]',
      '"SOUL.md" = "./SOUL.md"',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'config.yaml'), '# empty\n');
  writeFileSync(join(dir, 'SOUL.md'), '# empty\n');
  writeFileSync(join(dir, 'secrets.env.enc'), '# sops placeholder\n');
}

describe('adoptDeployment', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-adopt-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;
    adoptMock.mockReset();
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('requires --name', async () => {
    await expect(adoptDeployment({ projectPath: projectDir })).rejects.toThrow(
      /requires --name/,
    );
  });

  it('writes a full state entry when adoption succeeds', async () => {
    writeMinimalHermesToml(projectDir, 'recovered');
    adoptMock.mockResolvedValueOnce({
      ledger: {
        kind: 'aws',
        resources: {
          instance_id: 'i-recover',
          security_group_id: 'sg-recover',
          key_pair_name: 'kp-recover',
          eip_allocation_id: 'eipalloc-recover',
          region: 'eu-west-3',
        },
      },
      publicIp: '198.51.100.10',
    });

    const result = await adoptDeployment({
      name: 'recovered',
      projectPath: projectDir,
    });

    expect(result.persisted).toBe(true);
    expect(result.name).toBe('recovered');
    expect(result.cloud).toBe('aws');
    expect(result.publicIp).toBe('198.51.100.10');

    const store = new StateStore(getStatePaths());
    const state = await store.read();
    const d = state.deployments['recovered']!;
    expect(d.cloud).toBe('aws');
    if (d.cloud !== 'aws') return;
    expect(d.cloud_resources.instance_id).toBe('i-recover');
    expect(d.instance_ip).toBe('198.51.100.10');
    expect(d.last_config_hash).toBe('sha256:adopted');
    expect(d.last_nix_hash).toBe('sha256:adopted');
  });

  it('refuses to replace an existing entry without --force', async () => {
    writeMinimalHermesToml(projectDir, 'recovered');
    adoptMock.mockResolvedValue({
      ledger: {
        kind: 'aws',
        resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eip-1',
          region: 'eu-west-3',
        },
      },
      publicIp: '198.51.100.1',
    });
    await adoptDeployment({ name: 'recovered', projectPath: projectDir });

    await expect(
      adoptDeployment({ name: 'recovered', projectPath: projectDir }),
    ).rejects.toThrow(/state already has an entry/);

    // With --force it should work
    const result = await adoptDeployment({
      name: 'recovered',
      projectPath: projectDir,
      force: true,
    });
    expect(result.persisted).toBe(true);
  });

  it('does not write state when dryRun is set', async () => {
    writeMinimalHermesToml(projectDir, 'dryrun');
    adoptMock.mockResolvedValueOnce({
      ledger: {
        kind: 'aws',
        resources: {
          instance_id: 'i-dry',
          security_group_id: 'sg-dry',
          key_pair_name: 'kp-dry',
          eip_allocation_id: 'eipalloc-dry',
          region: 'eu-west-3',
        },
      },
      publicIp: '203.0.113.99',
    });

    const result = await adoptDeployment({
      name: 'dryrun',
      projectPath: projectDir,
      dryRun: true,
    });
    expect(result.persisted).toBe(false);
    expect(result.deployment.cloud).toBe('aws');

    const store = new StateStore(getStatePaths());
    const state = await store.read();
    expect(state.deployments['dryrun']).toBeUndefined();
  });

  it('rejects a name mismatch between --name and hermes.toml', async () => {
    writeMinimalHermesToml(projectDir, 'wrong-name');
    await expect(
      adoptDeployment({ name: 'right-name', projectPath: projectDir }),
    ).rejects.toThrow(/does not match/);
  });
});
