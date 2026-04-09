import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { generateHermesNix, generateConfigurationNix } from '../../../src/nix-gen/generate.js';
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
});

describe('generateConfigurationNix', () => {
  it('imports hermes.nix and pins the hermes-agent flake', () => {
    const out = generateConfigurationNix();
    expect(out).toContain('imports = [');
    expect(out).toContain('./hermes.nix');
    expect(out).toContain('hermes-agent');
  });
});
