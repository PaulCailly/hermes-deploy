import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDeployment } from '../../../src/commands/resolve.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

describe('resolveDeployment', () => {
  let configDir: string;
  let projectDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-resolve-'));
    configDir = join(root, 'config');
    projectDir = join(root, 'project');
    mkdirSync(configDir);
    mkdirSync(projectDir);
    process.env.XDG_CONFIG_HOME = configDir;

    writeFileSync(
      join(projectDir, 'hermes.toml'),
      `
name = "my-bot"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[hermes]
model = "m"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"
[hermes.platforms.discord]
enabled = true
token_key = "k"
`,
    );
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('resolves by --name from global state', async () => {
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['acme-bot'] = {
        project_path: '/some/path',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:x',
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
      };
    });

    const r = await resolveDeployment({ name: 'acme-bot', cwd: '/unrelated/dir' });
    expect(r.name).toBe('acme-bot');
    expect(r.projectPath).toBe('/some/path');
    expect(r.source).toBe('name');
  });

  it('resolves by --project path', async () => {
    const r = await resolveDeployment({ projectPath: projectDir, cwd: '/unrelated/dir' });
    expect(r.name).toBe('my-bot');
    expect(r.projectPath).toBe(projectDir);
    expect(r.source).toBe('project');
  });

  it('resolves by walking up from cwd', async () => {
    const nested = join(projectDir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const r = await resolveDeployment({ cwd: nested });
    expect(r.name).toBe('my-bot');
    expect(r.projectPath).toBe(projectDir);
    expect(r.source).toBe('cwd');
  });

  it('throws when nothing resolves', async () => {
    await expect(resolveDeployment({ cwd: '/nonexistent' })).rejects.toThrow(
      /no hermes\.toml/,
    );
  });

  it('rejects --name and --project together', async () => {
    await expect(
      resolveDeployment({ name: 'x', projectPath: '/y', cwd: '/z' }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('throws when --name is not in state', async () => {
    await expect(
      resolveDeployment({ name: 'missing', cwd: '/unrelated' }),
    ).rejects.toThrow(/not found in state/);
  });
});
