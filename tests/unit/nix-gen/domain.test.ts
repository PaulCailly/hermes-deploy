import { describe, it, expect } from 'vitest';
import { generateConfigurationNix } from '../../../src/nix-gen/generate.js';
import type { HermesTomlConfig } from '../../../src/schema/hermes-toml.js';

function baseConfig(domain?: { name: string; upstream_port: number }): HermesTomlConfig {
  return {
    name: 'test',
    cloud: { provider: 'aws', profile: 'default', region: 'eu-west-3', size: 'small', disk_gb: 30 },
    network: { ssh_allowed_from: 'auto', inbound_ports: [] },
    hermes: {
      config_file: './config.yaml',
      secrets_file: './secrets.env.enc',
      documents: {},
      environment: {},
    },
    domain,
  };
}

describe('configurationNix with domain', () => {
  it('includes nginx and ACME config when domain is set', () => {
    const nix = generateConfigurationNix(baseConfig({ name: 'jarvis.backresto.com', upstream_port: 3000 }));
    expect(nix).toContain('services.nginx');
    expect(nix).toContain('jarvis.backresto.com');
    expect(nix).toContain('http://127.0.0.1:3000');
    expect(nix).toContain('security.acme');
    expect(nix).toContain('networking.firewall.allowedTCPPorts');
    expect(nix).toContain('80');
    expect(nix).toContain('443');
  });

  it('does NOT include nginx config when domain is absent', () => {
    const nix = generateConfigurationNix(baseConfig());
    expect(nix).not.toContain('services.nginx');
    expect(nix).not.toContain('security.acme');
  });
});
