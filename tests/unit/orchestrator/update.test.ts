import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the rebuild to avoid the nohup+poll loop in orchestrator tests.
vi.mock('../../../src/remote-ops/nixos-rebuild.js', () => ({
  runNixosRebuild: vi.fn(async () => ({ success: true, tail: [] })),
}));

import { runUpdate } from '../../../src/orchestrator/update.js';
import type { CloudProvider } from '../../../src/cloud/core.js';
import type { SshSession } from '../../../src/remote-ops/session.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';
import { computeConfigHash } from '../../../src/state/hash.js';

function fakeProvider(): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(async () => {}),
    destroy: vi.fn(),
    status: vi.fn(async () => ({ state: 'running' as const, publicIp: '203.0.113.42' })),
  };
}

function healthySession(): SshSession {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: 'active', stderr: '' })),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    execStreamUntil: vi.fn(async () => ({ aborted: false, exitCode: 0 })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runUpdate', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-update-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir);
    process.env.XDG_CONFIG_HOME = configDir;

    writeFileSync(
      join(projectDir, 'hermes.toml'),
      `
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[network]
ssh_allowed_from = "auto"
inbound_ports = [443]
[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
[hermes.documents]
"SOUL.md" = "./SOUL.md"
`,
    );
    writeFileSync(join(projectDir, 'SOUL.md'), '# soul');
    writeFileSync(join(projectDir, 'config.yaml'), 'model:\n  default: test\n');
    writeFileSync(join(projectDir, 'secrets.env.enc'), 'sops: dummy\n');

    // Pre-create the per-deployment keys (no generation on update)
    mkdirSync(join(configDir, 'hermes-deploy/ssh_keys'), { recursive: true });
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    writeFileSync(
      join(configDir, 'hermes-deploy/ssh_keys/test'),
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----',
    );
    writeFileSync(
      join(configDir, 'hermes-deploy/ssh_keys/test.pub'),
      'ssh-ed25519 AAAA test',
    );
    writeFileSync(
      join(configDir, 'hermes-deploy/age_keys/test'),
      '# public key: age1abc\nAGE-SECRET-KEY-1abc\n',
    );

    // Seed state with an existing healthy deployment
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: projectDir,
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:old',
        last_nix_hash: 'sha256:old-nix',
        ssh_key_path: join(configDir, 'hermes-deploy/ssh_keys/test'),
        age_key_path: join(configDir, 'hermes-deploy/age_keys/test'),
        health: 'healthy',
        instance_ip: '203.0.113.42',
        cloud_resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eipalloc-1',
          region: 'eu-west-3',
        },
      };
    });
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('runs reconcileNetwork and bootstrap without calling provision', async () => {
    const provider = fakeProvider();
    const result = await runUpdate({
      deploymentName: 'test',
      provider,
      sessionFactory: async () => healthySession(),
      detectPublicIp: async () => '203.0.113.1/32',
      healthcheckTimeoutMs: 500,
    });

    expect(result.health).toBe('healthy');
    expect(result.skipped).toBe(false);
    expect(provider.provision).not.toHaveBeenCalled();
    expect(provider.reconcileNetwork).toHaveBeenCalledTimes(1);
  });

  it('short-circuits (no SSH, no reconcile) when the config hash has not changed', async () => {
    // Pre-populate state's last_config_hash with what the update will compute
    const store = new StateStore(getStatePaths());
    const currentHash = computeConfigHash(
      [
        join(projectDir, 'hermes.toml'),
        join(projectDir, 'config.yaml'),
        join(projectDir, 'secrets.env.enc'),
        join(projectDir, 'SOUL.md'),
      ],
      true,
    );
    await store.update(state => {
      state.deployments['test']!.last_config_hash = currentHash;
    });

    const provider = fakeProvider();
    const sessionFactory = vi.fn(async () => healthySession());

    const result = await runUpdate({
      deploymentName: 'test',
      provider,
      sessionFactory,
      detectPublicIp: async () => '203.0.113.1/32',
      healthcheckTimeoutMs: 500,
    });

    expect(result.skipped).toBe(true);
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(provider.reconcileNetwork).not.toHaveBeenCalled();
  });

  it('skips nixos-rebuild (but runs reconcileNetwork) when only network rules changed', async () => {
    // Pre-populate last_nix_hash with what a rebuild would store — the
    // hash of the nix-relevant files only (no hermes.toml). Then change
    // hermes.toml by updating inbound_ports — the full config hash
    // changes, so the no-op check at the top does NOT fire and
    // reconcileNetwork runs. But the nix files are untouched so the
    // network-only short-circuit should fire and skip SSH + rebuild.
    const nixHash = computeConfigHash(
      [
        join(projectDir, 'config.yaml'),
        join(projectDir, 'secrets.env.enc'),
        join(projectDir, 'SOUL.md'),
      ],
      true,
    );
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test']!.last_nix_hash = nixHash;
      // Keep last_config_hash stale so the full no-op check does NOT fire.
    });

    const provider = fakeProvider();
    const sessionFactory = vi.fn(async () => healthySession());

    const result = await runUpdate({
      deploymentName: 'test',
      provider,
      sessionFactory,
      detectPublicIp: async () => '203.0.113.1/32',
      healthcheckTimeoutMs: 500,
    });

    // Network reconciliation must have run.
    expect(provider.reconcileNetwork).toHaveBeenCalledTimes(1);
    // No SSH session should have been opened.
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(result.skipped).toBe(false);
    expect(result.health).toBe('healthy');
  });

  it('throws when the deployment is not in state', async () => {
    const provider = fakeProvider();
    await expect(
      runUpdate({
        deploymentName: 'missing',
        provider,
        sessionFactory: async () => healthySession(),
        detectPublicIp: async () => '1.1.1.1/32',
      }),
    ).rejects.toThrow(/not found/);
  });
});
