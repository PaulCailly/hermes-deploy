import { describe, it, expect, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStatePaths } from '../../../src/state/paths.js';

describe('getStatePaths', () => {
  const ORIG_XDG = process.env.XDG_CONFIG_HOME;
  afterEach(() => {
    if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  });

  it('uses ~/.config/hermes-deploy when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = getStatePaths();
    expect(p.configDir).toBe(join(homedir(), '.config', 'hermes-deploy'));
    expect(p.stateFile).toBe(join(p.configDir, 'state.toml'));
    expect(p.lockFile).toBe(join(p.configDir, 'state.toml.lock'));
    expect(p.sshKeysDir).toBe(join(p.configDir, 'ssh_keys'));
    expect(p.ageKeysDir).toBe(join(p.configDir, 'age_keys'));
    expect(p.imageCacheFile).toBe(join(homedir(), '.cache', 'hermes-deploy', 'images.json'));
  });

  it('honors XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    const p = getStatePaths();
    expect(p.configDir).toBe('/custom/config/hermes-deploy');
    expect(p.stateFile).toBe('/custom/config/hermes-deploy/state.toml');
  });

  it('returns the right per-deployment ssh and age key paths', () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = getStatePaths();
    expect(p.sshKeyForDeployment('acme-discord')).toBe(join(p.sshKeysDir, 'acme-discord'));
    expect(p.ageKeyForDeployment('acme-discord')).toBe(join(p.ageKeysDir, 'acme-discord'));
  });
});
