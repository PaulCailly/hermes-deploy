import { describe, it, expect } from 'vitest';
import { StateTomlSchema, type StateToml } from '../../../src/schema/state-toml.js';

describe('StateTomlSchema', () => {
  it('accepts an empty state', () => {
    const result = StateTomlSchema.safeParse({ schema_version: 4, deployments: {} });
    expect(result.success).toBe(true);
  });

  it('accepts a state with one AWS deployment', () => {
    const state: StateToml = {
      schema_version: 4,
      deployments: {
        'acme-discord-bot': {
          project_path: '/Users/paul/clients/acme/discord-bot',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc123',
          last_nix_hash: 'sha256:abc123',
          hermes_agent_rev: 'abc1234567890',
          hermes_agent_tag: 'v2026.4.16',
          ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/acme-discord-bot',
          age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/acme-discord-bot',
          health: 'healthy',
          instance_ip: '203.0.113.42',
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-acme-discord-bot',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    };
    const result = StateTomlSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('accepts a deployment with domain_name and dns_record_id', () => {
    const state: StateToml = {
      schema_version: 4,
      deployments: {
        'acme-discord-bot': {
          project_path: '/Users/paul/clients/acme/discord-bot',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc123',
          last_nix_hash: 'sha256:abc123',
          hermes_agent_rev: 'abc1234567890',
          hermes_agent_tag: 'v2026.4.16',
          ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/acme-discord-bot',
          age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/acme-discord-bot',
          health: 'healthy',
          instance_ip: '203.0.113.42',
          domain_name: 'bot.acme.example.com',
          dns_record_id: 'Z0ABC123DEF456/bot.acme.example.com',
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-acme-discord-bot',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    };
    const result = StateTomlSchema.safeParse(state);
    expect(result.success).toBe(true);
    if (result.success) {
      const dep = result.data.deployments['acme-discord-bot']!;
      expect(dep.domain_name).toBe('bot.acme.example.com');
      expect(dep.dns_record_id).toBe('Z0ABC123DEF456/bot.acme.example.com');
    }
  });

  it('accepts a deployment without domain fields (backward compat)', () => {
    const state: StateToml = {
      schema_version: 4,
      deployments: {
        'acme-discord-bot': {
          project_path: '/Users/paul/clients/acme/discord-bot',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc123',
          last_nix_hash: 'sha256:abc123',
          hermes_agent_rev: 'unknown',
          hermes_agent_tag: '',
          ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/acme-discord-bot',
          age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/acme-discord-bot',
          health: 'healthy',
          instance_ip: '203.0.113.42',
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-acme-discord-bot',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    };
    const result = StateTomlSchema.safeParse(state);
    expect(result.success).toBe(true);
    if (result.success) {
      const dep = result.data.deployments['acme-discord-bot']!;
      expect(dep.domain_name).toBeUndefined();
      expect(dep.dns_record_id).toBeUndefined();
    }
  });

  it('accepts a deployment with profile_hashes', () => {
    const result = StateTomlSchema.safeParse({
      schema_version: 4,
      deployments: {
        'multi-profile': {
          project_path: '/Users/paul/agents/multi',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-24T10:00:00Z',
          last_deployed_at: '2026-04-24T10:05:00Z',
          last_config_hash: 'sha256:abc123',
          last_nix_hash: 'sha256:abc123',
          hermes_agent_rev: 'abc1234567890',
          hermes_agent_tag: '',
          ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/multi-profile',
          age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/multi-profile',
          health: 'healthy',
          instance_ip: '203.0.113.50',
          profile_hashes: {
            coder: 'sha256:def456',
            assistant: 'sha256:ghi789',
          },
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-multi-profile',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const dep = result.data.deployments['multi-profile']!;
      expect(dep.profile_hashes).toEqual({
        coder: 'sha256:def456',
        assistant: 'sha256:ghi789',
      });
    }
  });

  it('accepts a deployment without profile_hashes (backward compat)', () => {
    const result = StateTomlSchema.safeParse({
      schema_version: 4,
      deployments: {
        'no-profiles': {
          project_path: '/Users/paul/agents/single',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-24T10:00:00Z',
          last_deployed_at: '2026-04-24T10:05:00Z',
          last_config_hash: 'sha256:abc123',
          last_nix_hash: 'sha256:abc123',
          hermes_agent_rev: 'unknown',
          hermes_agent_tag: '',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'healthy',
          instance_ip: '203.0.113.51',
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-no-profiles',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const dep = result.data.deployments['no-profiles']!;
      expect(dep.profile_hashes).toBeUndefined();
    }
  });

  it('rejects unknown schema_version', () => {
    const result = StateTomlSchema.safeParse({ schema_version: 99, deployments: {} });
    expect(result.success).toBe(false);
  });

  it('rejects deployment without required cloud_resources fields', () => {
    const result = StateTomlSchema.safeParse({
      schema_version: 4,
      deployments: {
        bad: {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'unknown',
          instance_ip: '0.0.0.0',
          cloud_resources: { instance_id: 'i-0abc' }, // missing the rest
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a deployment whose cloud field does not match cloud_resources shape', () => {
    const result = StateTomlSchema.safeParse({
      schema_version: 4,
      deployments: {
        mismatch: {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:23:11Z',
          last_config_hash: 'sha256:abc',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'unknown',
          instance_ip: '0.0.0.0',
          // GCP-shaped cloud_resources while cloud="aws" — must reject
          cloud_resources: {
            instance_name: 'i',
            firewall_rule_name: 'f',
            project_id: 'p',
            zone: 'z',
            external_ip: '0.0.0.0',
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
