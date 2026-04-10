import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  secretSet,
  secretGet,
  secretRemove,
  secretList,
} from '../../../src/commands/secret.js';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

const sopsAvailable = (() => {
  try {
    execSync('which sops', { stdio: 'ignore' });
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sopsAvailable)('secret subcommands', () => {
  let projectDir: string;
  let configDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'hermes-secret-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;

    // Generate a real age key
    const ageOutput = execSync('age-keygen', { encoding: 'utf-8' });
    const pubMatch = ageOutput.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!pubMatch || !pubMatch[1]) throw new Error('age-keygen output missing public key');
    const publicKey = pubMatch[1];
    const ageKeyPath = join(configDir, 'hermes-deploy/age_keys/test');
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    writeFileSync(ageKeyPath, ageOutput);
    process.env['SOPS_AGE_KEY_FILE'] = ageKeyPath;

    // Bootstrap sops files in projectDir
    ensureSopsBootstrap(projectDir, publicKey);

    // Seed state with a deployment pointing at projectDir
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: projectDir,
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:x',
        ssh_key_path: '/x',
        age_key_path: ageKeyPath,
        health: 'healthy',
        instance_ip: '0.0.0.0',
        cloud_resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eipalloc-1',
          region: 'eu-west-3',
        },
      };
    });

    // hermes.toml so cwd resolution works from projectDir
    writeFileSync(
      join(projectDir, 'hermes.toml'),
      `
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
`,
    );
    writeFileSync(join(projectDir, 'config.yaml'), 'model: m\n');
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('sets and gets a secret value', async () => {
    await secretSet({ key: 'discord_bot_token', value: 'my-token-123' });
    const got = await secretGet({ key: 'discord_bot_token' });
    expect(got).toBe('my-token-123');
  });

  it('lists secret keys', async () => {
    await secretSet({ key: 'a', value: '1' });
    await secretSet({ key: 'b', value: '2' });
    const keys = await secretList({});
    expect(keys).toContain('a');
    expect(keys).toContain('b');
  });

  it('removes a secret', async () => {
    await secretSet({ key: 'ephemeral', value: 'gone' });
    await secretRemove({ key: 'ephemeral' });
    const keys = await secretList({});
    expect(keys).not.toContain('ephemeral');
  });
});
