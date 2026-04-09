import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runDeploy } from '../../../src/orchestrator/deploy.js';
import type { CloudProvider } from '../../../src/cloud/core.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeProvider(): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(async () => ({ id: 'ami-1', description: 'nixos' })),
    provision: vi.fn(async (_spec, ledger) => {
      if (ledger.kind === 'aws') {
        ledger.resources.instance_id = 'i-1';
        ledger.resources.security_group_id = 'sg-1';
        ledger.resources.key_pair_name = 'kp-1';
        ledger.resources.eip_allocation_id = 'eipalloc-1';
        ledger.resources.region = 'eu-west-3';
      }
      return { publicIp: '203.0.113.42', sshUser: 'root' };
    }),
    destroy: vi.fn(async () => {}),
    status: vi.fn(async () => ({ state: 'running' as const, publicIp: '203.0.113.42' })),
  };
}

function fakeSession(): SshSession {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: 'active', stderr: '' })),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runDeploy (happy path)', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-deploy-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir);
    writeFileSync(join(projectDir, 'hermes.toml'), `
name = "test"
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
`);
    writeFileSync(join(projectDir, 'SOUL.md'), '# soul');
    writeFileSync(join(projectDir, 'secrets.enc.yaml'), 'sops: {}\ndata: {}');
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('runs all phases and updates state', async () => {
    process.env.XDG_CONFIG_HOME = configDir;

    const provider = fakeProvider();
    const result = await runDeploy({
      projectDir,
      provider,
      sessionFactory: async () => fakeSession(),
      detectPublicIp: async () => '203.0.113.1/32',
      ageKeyGenerator: async (path: string) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, '# public key: age1abc\nAGE-SECRET-KEY-1abc\n');
        return { publicKey: 'age1abc', privateKeyPath: path };
      },
      sshKeyGenerator: async (path: string) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----');
        writeFileSync(`${path}.pub`, 'ssh-ed25519 AAAA test');
        return { publicKey: 'ssh-ed25519 AAAA test', privateKeyPath: path, publicKeyPath: `${path}.pub` };
      },
      sopsBootstrap: async () => {},
      waitSsh: async () => {},
    });

    expect(result.health).toBe('healthy');
    expect(result.publicIp).toBe('203.0.113.42');
    expect(provider.provision).toHaveBeenCalledTimes(1);
  });
});
