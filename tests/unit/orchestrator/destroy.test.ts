import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDestroy } from '../../../src/orchestrator/destroy.js';
import type { CloudProvider } from '../../../src/cloud/core.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

function fakeProvider(destroyImpl?: () => Promise<void>): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    destroy: vi.fn(destroyImpl ?? (async () => {})),
    status: vi.fn(),
  } as any;
}

describe('runDestroy', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-destroy-'));
    process.env.XDG_CONFIG_HOME = configDir;
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('calls provider.destroy and removes the state entry', async () => {
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: '/x',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-09T00:00:00Z',
        last_deployed_at: '2026-04-09T00:00:00Z',
        last_config_hash: 'sha256:x',
          last_nix_hash: 'sha256:x',
        ssh_key_path: '/x',
        age_key_path: '/x',
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

    const provider = fakeProvider();
    await runDestroy({ deploymentName: 'test', provider });

    expect(provider.destroy).toHaveBeenCalled();
    const state = await store.read();
    expect(state.deployments['test']).toBeUndefined();
  });

  it('throws if the deployment is not in state', async () => {
    const provider = fakeProvider();
    await expect(runDestroy({ deploymentName: 'missing', provider })).rejects.toThrow(/not found/);
  });
});
