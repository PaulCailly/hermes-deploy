import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDeploymentSummaries } from '../../../src/commands/ls.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';
import type { CloudProvider } from '../../../src/cloud/core.js';

function stubProvider(state: 'running' | 'stopped' = 'running'): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn(async () => ({ state, publicIp: '203.0.113.42' })),
    adopt: vi.fn(),
  };
}

describe('collectDeploymentSummaries', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-ls-'));
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;

    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['acme'] = {
        project_path: '/acme',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-05T00:00:00Z',
        last_config_hash: 'sha256:acme',
          last_nix_hash: 'sha256:acme',
        ssh_key_path: '/x',
        age_key_path: '/x',
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
      state.deployments['beta'] = {
        project_path: '/beta',
        cloud: 'aws',
        region: 'us-east-1',
        created_at: '2026-04-02T00:00:00Z',
        last_deployed_at: '2026-04-06T00:00:00Z',
        last_config_hash: 'sha256:beta',
          last_nix_hash: 'sha256:beta',
        ssh_key_path: '/y',
        age_key_path: '/y',
        health: 'unhealthy',
        instance_ip: '203.0.113.43',
        cloud_resources: {
          instance_id: 'i-2',
          security_group_id: 'sg-2',
          key_pair_name: 'kp-2',
          eip_allocation_id: 'eipalloc-2',
          region: 'us-east-1',
        },
      };
    });
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('returns one summary per deployment, sorted by name', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: false });
    expect(summaries.map(s => s.name)).toEqual(['acme', 'beta']);
    expect(summaries[0]!.storedHealth).toBe('healthy');
    expect(summaries[1]!.storedHealth).toBe('unhealthy');
  });

  it('includes live status when live=true', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: true });
    expect(summaries[0]!.liveState).toBe('running');
    expect(summaries[1]!.liveState).toBe('running');
  });

  it('omits live status when live=false', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: false });
    expect(summaries[0]!.liveState).toBeUndefined();
  });

  it('marks liveState=error when provider.status throws', async () => {
    const failingProvider: CloudProvider = {
      name: 'aws',
      resolveNixosImage: vi.fn(),
      provision: vi.fn(),
      reconcileNetwork: vi.fn(),
      destroy: vi.fn(),
      status: vi.fn(async () => { throw new Error('boom'); }),
      adopt: vi.fn(),
    };
    const summaries = await collectDeploymentSummaries({
      providerFactory: () => failingProvider,
      live: true,
    });
    expect(summaries[0]!.liveState).toBe('error');
    expect(summaries[1]!.liveState).toBe('error');
  });
});
