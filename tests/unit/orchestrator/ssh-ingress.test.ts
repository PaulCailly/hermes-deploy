import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { refreshSshIngress } from '../../../src/orchestrator/ssh-ingress.js';
import type { CloudProvider } from '../../../src/cloud/core.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

function fakeProvider(): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(async () => {}),
    destroy: vi.fn(),
    status: vi.fn(async () => ({ state: 'running' as const, publicIp: '203.0.113.42' })),
    adopt: vi.fn(async () => ({
      ledger: { kind: 'aws' as const, resources: {} },
      publicIp: null,
    })),
  };
}

const baseToml = (sshAllowedFrom: string) => `
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[network]
ssh_allowed_from = "${sshAllowedFrom}"
inbound_ports = [443]
[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
`;

describe('refreshSshIngress', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-ssh-ingress-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir);
    process.env.XDG_CONFIG_HOME = configDir;

    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: projectDir,
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:x',
        last_nix_hash: 'sha256:x',
        ssh_key_path: '/dev/null',
        age_key_path: '/dev/null',
        health: 'healthy',
        instance_ip: '203.0.113.42',
        hermes_agent_rev: 'unknown',
        hermes_agent_tag: '',
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

  it('reconciles the SG to the current public IP when ssh_allowed_from = "auto"', async () => {
    writeFileSync(join(projectDir, 'hermes.toml'), baseToml('auto'));
    const provider = fakeProvider();

    const applied = await refreshSshIngress({
      deploymentName: 'test',
      provider,
      detectPublicIp: async () => '198.51.100.7/32',
    });

    expect(applied).toBe('198.51.100.7/32');
    expect(provider.reconcileNetwork).toHaveBeenCalledOnce();
    const [ledger, rules] = vi.mocked(provider.reconcileNetwork).mock.calls[0]!;
    expect(ledger).toMatchObject({ kind: 'aws', resources: { security_group_id: 'sg-1' } });
    expect(rules).toEqual({
      sshAllowedFrom: '198.51.100.7/32',
      inboundPorts: [443],
      hasDomain: false,
    });
  });

  it('skips (returns null, no API call) when ssh_allowed_from is a pinned CIDR', async () => {
    writeFileSync(join(projectDir, 'hermes.toml'), baseToml('192.0.2.0/24'));
    const provider = fakeProvider();

    const applied = await refreshSshIngress({
      deploymentName: 'test',
      provider,
      detectPublicIp: async () => '198.51.100.7/32',
    });

    expect(applied).toBeNull();
    expect(provider.reconcileNetwork).not.toHaveBeenCalled();
  });

  it('skips (returns null) when the project hermes.toml is missing', async () => {
    const provider = fakeProvider();

    const applied = await refreshSshIngress({
      deploymentName: 'test',
      provider,
      detectPublicIp: async () => '198.51.100.7/32',
    });

    expect(applied).toBeNull();
    expect(provider.reconcileNetwork).not.toHaveBeenCalled();
  });
});
