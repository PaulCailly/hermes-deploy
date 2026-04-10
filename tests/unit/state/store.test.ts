import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../../../src/state/store.js';

describe('StateStore', () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-store-'));
    store = new StateStore({
      configDir: tmpDir,
      stateFile: join(tmpDir, 'state.toml'),
      lockFile: join(tmpDir, 'state.toml.lock'),
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty state when the file does not exist', async () => {
    const state = await store.read();
    expect(state.schema_version).toBe(3);
    expect(state.deployments).toEqual({});
  });

  it('persists and re-reads a deployment', async () => {
    const deployment = makeDeployment();
    await store.update(s => {
      s.deployments['test'] = deployment;
    });
    const state = await store.read();
    expect(state.deployments['test']?.cloud).toBe('aws');
    expect(state.deployments['test']?.cloud_resources).toMatchObject({ instance_id: 'i-1' });
  });

  it('creates a backup before overwriting', async () => {
    await store.update(s => { s.deployments['a'] = makeDeployment(); });
    await store.update(s => { s.deployments['b'] = makeDeployment('b'); });
    const backups = readBackups(tmpDir);
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects state files with unknown schema_version', async () => {
    writeFileSync(join(tmpDir, 'state.toml'), 'schema_version = 99\n[deployments]\n');
    await expect(store.read()).rejects.toThrow(/schema_version/);
  });

  it('serializes concurrent updates via the lock file (no interleaving)', async () => {
    const order: number[] = [];
    const a = store.update(async s => {
      order.push(1);
      await new Promise(r => setTimeout(r, 50));
      s.deployments['a'] = makeDeployment('a');
      order.push(2);
    });
    const b = store.update(async s => {
      order.push(3);
      s.deployments['b'] = makeDeployment('b');
      order.push(4);
    });
    await Promise.all([a, b]);
    // The lockfile must serialize the two updates so neither interleaves with
    // the other. We don't require a FIFO ordering — proper-lockfile doesn't
    // guarantee it — only that each pair of (start, end) markers is adjacent.
    expect(Math.abs(order.indexOf(1) - order.indexOf(2))).toBe(1);
    expect(Math.abs(order.indexOf(3) - order.indexOf(4))).toBe(1);
    expect(order).toHaveLength(4);
  });
});

function makeDeployment(name = 'test') {
  return {
    project_path: '/x',
    cloud: 'aws' as const,
    region: 'eu-west-3',
    created_at: '2026-04-09T00:00:00Z',
    last_deployed_at: '2026-04-09T00:00:00Z',
    last_config_hash: 'sha256:abc',
    last_nix_hash: 'sha256:abc',
    ssh_key_path: `/x/${name}`,
    age_key_path: `/x/${name}`,
    health: 'unknown' as const,
    instance_ip: '0.0.0.0',
    cloud_resources: {
      instance_id: 'i-1',
      security_group_id: 'sg-1',
      key_pair_name: `kp-${name}`,
      eip_allocation_id: 'eipalloc-1',
      region: 'eu-west-3',
    },
  };
}

function readBackups(dir: string): string[] {
  const { readdirSync } = require('node:fs');
  return readdirSync(dir).filter((n: string) => n.startsWith('state.toml.bak.'));
}
