import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  generateHermesNix,
  generateConfigurationNix,
  generateFlakeNix,
} from '../../../src/nix-gen/generate.js';
import { loadHermesToml } from '../../../src/schema/load.js';

const fixturesDir = join(__dirname, '../../fixtures');

describe('generateHermesNix', () => {
  it('matches the snapshot for minimal.toml', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/minimal.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/minimal.hermes.nix'),
    );
  });

  it('matches the snapshot for full.toml', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/full.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/full.hermes.nix'),
    );
  });

  it('throws on a nix_extra path that contains characters invalid in a Nix literal', () => {
    // nix_extra is the only remaining place generateHermesNix emits a path
    // literal (M1's soul/secrets_file paths were dropped because they
    // weren't real upstream options). The validation rejects spaces and
    // other non-[A-Za-z0-9._+-/] characters so a malformed path doesn't
    // silently produce broken Nix.
    expect(() => generateHermesNix({
      name: 'x',
      cloud: { provider: 'aws', profile: 'default', region: 'eu-west-3', size: 'small', disk_gb: 30 },
      network: { ssh_allowed_from: 'auto', inbound_ports: [] },
      hermes: {
        model: 'm',
        soul: './SOUL.md',
        secrets_file: './secrets.enc.yaml',
        platforms: { discord: { enabled: true, token_key: 'k' } },
        mcp_servers: [],
        nix_extra: { file: './path with space/extra.nix' },
      },
    })).toThrow(/invalid in a Nix path literal/);
  });
});

describe('generateConfigurationNix', () => {
  it('imports amazon-image, enables flakes, and declares the sops config', () => {
    const out = generateConfigurationNix();
    expect(out).toContain('imports = [');
    expect(out).toContain('virtualisation/amazon-image.nix');
    expect(out).toContain('experimental-features');
    expect(out).toContain('sops');
    expect(out).toContain('system.stateVersion = "25.11"');
  });
});

describe('generateFlakeNix', () => {
  it('declares nixpkgs, sops-nix, and hermes-agent as inputs', () => {
    const out = generateFlakeNix();
    expect(out).toContain('inputs =');
    expect(out).toContain('nixpkgs');
    expect(out).toContain('sops-nix');
    expect(out).toContain('hermes-agent');
  });

  it('builds nixosConfigurations.default with the right modules', () => {
    const out = generateFlakeNix();
    expect(out).toContain('nixosConfigurations.default');
    expect(out).toContain('./configuration.nix');
    expect(out).toContain('./hermes.nix');
    expect(out).toContain('hermes-agent.nixosModules.default');
    expect(out).toContain('sops-nix.nixosModules.sops');
  });
});
