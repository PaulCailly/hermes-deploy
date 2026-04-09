import { describe, it, expect } from 'vitest';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../../../src/state/migrations.js';

describe('runMigrations', () => {
  it('exports the current version constant', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it('is a no-op on already-current state', () => {
    const state = { schema_version: 1, deployments: {} };
    const migrated = runMigrations(state);
    expect(migrated).toEqual(state);
  });

  it('migrates a synthetic v0 state to v1', () => {
    // v0 had no schema_version field and stored deployments as a flat
    // array with per-entry `name` and a separate `aws`/`gcp` field
    // instead of cloud_resources.
    const v0 = {
      deployments: [
        {
          name: 'legacy',
          project_path: '/legacy',
          cloud: 'aws',
          region: 'eu-west-3',
          last_deployed: '2025-06-01T00:00:00Z',
          aws: {
            instance_id: 'i-old',
            security_group_id: 'sg-old',
            key_pair_name: 'kp-old',
            eip_allocation_id: 'eipalloc-old',
          },
        },
      ],
    };
    const migrated = runMigrations(v0) as any;
    expect(migrated.schema_version).toBe(1);
    expect(migrated.deployments.legacy).toBeDefined();
    expect(migrated.deployments.legacy.cloud).toBe('aws');
    expect(migrated.deployments.legacy.cloud_resources.instance_id).toBe('i-old');
    expect(migrated.deployments.legacy.cloud_resources.region).toBe('eu-west-3');
    expect(migrated.deployments.legacy.last_config_hash).toBe('sha256:migrated');
  });

  it('throws on a future schema_version', () => {
    expect(() => runMigrations({ schema_version: 99, deployments: {} })).toThrow(
      /newer/,
    );
  });

  it('throws on an unrecognized v0-shaped input that we cannot migrate', () => {
    expect(() => runMigrations({ schema_version: 0, deployments: {} })).toThrow(
      /unrecognized/,
    );
  });
});
