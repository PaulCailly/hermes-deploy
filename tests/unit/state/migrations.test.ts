import { describe, it, expect } from 'vitest';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../../../src/state/migrations.js';

describe('runMigrations', () => {
  it('exports the current version constant', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
  });

  it('migrates a v1 state to v4', () => {
    const state = { schema_version: 1, deployments: {} };
    const migrated = runMigrations(state) as any;
    expect(migrated.schema_version).toBe(4);
  });

  it('migrates a synthetic v0 state to v4', () => {
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
    expect(migrated.schema_version).toBe(4);
    expect(migrated.deployments.legacy).toBeDefined();
    expect(migrated.deployments.legacy.cloud).toBe('aws');
    expect(migrated.deployments.legacy.cloud_resources.instance_id).toBe('i-old');
    expect(migrated.deployments.legacy.cloud_resources.region).toBe('eu-west-3');
    expect(migrated.deployments.legacy.last_config_hash).toBe('sha256:migrated');
    // v3 migration adds last_nix_hash
    expect(migrated.deployments.legacy.last_nix_hash).toBe('sha256:unknown');
    // v4 migration adds hermes_agent_rev and hermes_agent_tag
    expect(migrated.deployments.legacy.hermes_agent_rev).toBe('unknown');
    expect(migrated.deployments.legacy.hermes_agent_tag).toBe('');
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

  it('exposes CURRENT_SCHEMA_VERSION === 4 after the v4 bump', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
  });

  it('migrates a v1 state file to v4 (v1→v2→v3→v4)', () => {
    const v1 = {
      schema_version: 1,
      deployments: {
        'm2-leftover': {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T00:00:00Z',
          last_deployed_at: '2026-04-09T00:00:00Z',
          last_config_hash: 'sha256:m2',
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
        },
      },
    };
    const migrated = runMigrations(v1) as any;
    expect(migrated.schema_version).toBe(4);
    expect(migrated.deployments['m2-leftover'].cloud_resources.instance_id).toBe('i-1');
    // v3 migration adds last_nix_hash defaulting to 'sha256:unknown'
    expect(migrated.deployments['m2-leftover'].last_nix_hash).toBe('sha256:unknown');
    // v4 migration adds hermes_agent_rev and hermes_agent_tag
    expect(migrated.deployments['m2-leftover'].hermes_agent_rev).toBe('unknown');
    expect(migrated.deployments['m2-leftover'].hermes_agent_tag).toBe('');
  });

  it('migrates a v2 state file to v4, adding last_nix_hash, hermes_agent_rev, hermes_agent_tag', () => {
    const v2 = {
      schema_version: 2,
      deployments: {
        'my-bot': {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T00:00:00Z',
          last_deployed_at: '2026-04-09T00:00:00Z',
          last_config_hash: 'sha256:abc',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'healthy',
          instance_ip: '1.2.3.4',
          cloud_resources: {
            instance_id: 'i-1',
            security_group_id: 'sg-1',
            key_pair_name: 'kp-1',
            eip_allocation_id: 'eipalloc-1',
            region: 'eu-west-3',
          },
        },
      },
    };
    const migrated = runMigrations(v2) as any;
    expect(migrated.schema_version).toBe(4);
    expect(migrated.deployments['my-bot'].last_nix_hash).toBe('sha256:unknown');
    // Existing fields are preserved
    expect(migrated.deployments['my-bot'].last_config_hash).toBe('sha256:abc');
    // v4 fields
    expect(migrated.deployments['my-bot'].hermes_agent_rev).toBe('unknown');
    expect(migrated.deployments['my-bot'].hermes_agent_tag).toBe('');
  });

  it('migrates a v3 state to v4, adding hermes_agent_rev and hermes_agent_tag', () => {
    const v3 = {
      schema_version: 3,
      deployments: {
        'my-agent': {
          project_path: '/x',
          cloud: 'gcp',
          region: 'europe-west1',
          created_at: '2026-04-09T00:00:00Z',
          last_deployed_at: '2026-04-09T00:00:00Z',
          last_config_hash: 'sha256:xyz',
          last_nix_hash: 'sha256:abc123',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'healthy',
          instance_ip: '34.0.0.1',
          cloud_resources: {
            instance_name: 'inst-1',
            static_ip_name: 'ip-1',
            firewall_rule_names: ['fw-1'],
            project_id: 'proj-1',
            zone: 'europe-west1-b',
          },
        },
      },
    };
    const migrated = runMigrations(v3) as any;
    expect(migrated.schema_version).toBe(4);
    // Existing fields preserved
    expect(migrated.deployments['my-agent'].last_nix_hash).toBe('sha256:abc123');
    expect(migrated.deployments['my-agent'].last_config_hash).toBe('sha256:xyz');
    // v4 adds hermes_agent_rev and hermes_agent_tag
    expect(migrated.deployments['my-agent'].hermes_agent_rev).toBe('unknown');
    expect(migrated.deployments['my-agent'].hermes_agent_tag).toBe('');
  });

  it('is a no-op on already-current v4 state', () => {
    const v4 = { schema_version: 4, deployments: {} };
    const migrated = runMigrations(v4);
    expect(migrated).toEqual(v4);
  });
});
