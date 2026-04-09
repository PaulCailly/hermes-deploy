import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const fixturesDir = join(__dirname, '../../fixtures/hermes-toml');
const loadFixture = (name: string) =>
  parseToml(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('HermesTomlSchema', () => {
  it('accepts a minimal valid config', () => {
    const raw = loadFixture('minimal.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-minimal');
      expect(result.data.cloud.provider).toBe('aws');
      expect(result.data.cloud.size).toBe('small');
      expect(result.data.network.ssh_allowed_from).toBe('auto'); // default
      expect(result.data.network.inbound_ports).toEqual([]); // default
    }
  });

  it('accepts a full config with telegram, mcp servers, and nix_extra', () => {
    const raw = loadFixture('full.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.network.inbound_ports).toEqual([443]);
      expect(result.data.hermes.mcp_servers).toHaveLength(1);
      expect(result.data.hermes.mcp_servers[0]?.name).toBe('github');
      expect(result.data.hermes.nix_extra?.file).toBe('./configuration.nix.extra');
    }
  });

  it('rejects an invalid config', () => {
    const raw = loadFixture('invalid.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('cloud.provider');
      expect(issues).toContain('cloud.size');
    }
  });

  it('requires gcp configs to specify zone', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'gcp-no-zone',
      cloud: { provider: 'gcp', profile: 'p', region: 'europe-west1', size: 'small' },
      hermes: {
        model: 'm',
        soul: './SOUL.md',
        secrets_file: './secrets.enc.yaml',
        platforms: { discord: { enabled: true, token_key: 'k' } },
      },
    });
    expect(result.success).toBe(false);
  });
});
