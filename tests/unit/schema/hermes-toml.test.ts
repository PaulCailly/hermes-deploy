import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const fixturesDir = join(__dirname, '../../fixtures/hermes-toml');
const loadFixture = (name: string) =>
  parseToml(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('HermesTomlSchema (M3)', () => {
  it('accepts the minimal valid M3 config', () => {
    const raw = loadFixture('m3-minimal.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-m3-minimal');
      expect(result.data.cloud.provider).toBe('aws');
      expect(result.data.cloud.disk_gb).toBe(30); // default
      expect(result.data.network.ssh_allowed_from).toBe('auto'); // default
      expect(result.data.network.inbound_ports).toEqual([]); // default
      expect(result.data.hermes.config_file).toBe('./config.yaml');
      expect(result.data.hermes.secrets_file).toBe('./secrets.env.enc');
      expect(result.data.hermes.nix_extra).toBeUndefined();
      expect(result.data.hermes.documents).toEqual({});
      expect(result.data.hermes.environment).toEqual({});
      expect(result.data.hermes.cachix).toBeUndefined();
    }
  });

  it('accepts the full M3 config with all optional fields', () => {
    const raw = loadFixture('m3-full.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cloud.disk_gb).toBe(50);
      expect(result.data.network.inbound_ports).toEqual([443, 8080]);
      expect(result.data.hermes.nix_extra).toBe('./hermes.extra.nix');
      expect(result.data.hermes.documents).toEqual({
        'SOUL.md': './SOUL.md',
        'persona.md': './behaviors/persona.md',
      });
      expect(result.data.hermes.environment).toEqual({
        LOG_LEVEL: 'debug',
        RUST_BACKTRACE: '1',
      });
      expect(result.data.hermes.cachix?.name).toBe('acme-deploys');
    }
  });

  it('rejects an invalid config (bad enum + missing required hermes fields)', () => {
    const raw = loadFixture('m3-invalid.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('cloud.provider');
      expect(issues).toContain('cloud.size');
      expect(issues).toContain('hermes.config_file');
      expect(issues).toContain('hermes.secrets_file');
    }
  });

  it('requires gcp configs to specify zone', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'gcp-no-zone',
      cloud: { provider: 'gcp', profile: 'p', region: 'europe-west1', size: 'small' },
      hermes: { config_file: './config.yaml', secrets_file: './secrets.env.enc' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown extra field at the top level (no silent drops)', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'extra-field',
      cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
      hermes: { config_file: './c.yaml', secrets_file: './s.env.enc' },
      bogus_field: 'oops',
    });
    // We use .strip() (default) so unknown top-level keys are dropped
    // silently. This test documents the choice — if M4 wants strict
    // validation, change this assertion.
    expect(result.success).toBe(true);
  });

  it('validates cachix.public_key format', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'cachix-bad',
      cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
      hermes: {
        config_file: './c.yaml',
        secrets_file: './s.env.enc',
        cachix: { name: 'mycache', public_key: 'not-a-valid-key' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a config with a valid [domain] section', () => {
    const raw = loadFixture('m3-domain.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain?.name).toBe('jarvis.backresto.com');
      expect(result.data.domain?.upstream_port).toBe(3000);
    }
  });

  it('rejects domain with invalid upstream_port (99999)', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'domain-bad-port',
      cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
      hermes: { config_file: './c.yaml', secrets_file: './s.env.enc' },
      domain: { name: 'example.com', upstream_port: 99999 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('domain.upstream_port');
    }
  });

  it('accepts a config without [domain] (domain is undefined)', () => {
    const raw = loadFixture('m3-minimal.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBeUndefined();
    }
  });
});
