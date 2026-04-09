import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { initCommand } from '../../../src/commands/init.js';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';
import { parse as parseToml } from 'smol-toml';

const sopsAvailable = (() => {
  try {
    execSync('which sops', { stdio: 'ignore' });
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sopsAvailable)('initCommand (M3)', () => {
  let dir: string;
  let configDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-init-m3-'));
    dir = join(root, 'project');
    configDir = join(root, 'config');
    process.env.XDG_CONFIG_HOME = configDir;
    mkdirSync(dir);
    mkdirSync(configDir);
  });
  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('creates the full M3 file set', async () => {
    await initCommand({ name: 'test-bot', dir });
    expect(existsSync(join(dir, 'hermes.toml'))).toBe(true);
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, '.sops.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'secrets.env.enc'))).toBe(true);
  });

  it('produces a hermes.toml that parses cleanly through the M3 schema', async () => {
    await initCommand({ name: 'parse-test', dir });
    const raw = readFileSync(join(dir, 'hermes.toml'), 'utf-8');
    const parsed = parseToml(raw);
    const result = HermesTomlSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hermes.config_file).toBe('./config.yaml');
      expect(result.data.hermes.secrets_file).toBe('./secrets.env.enc');
      expect(result.data.hermes.documents['SOUL.md']).toBe('./SOUL.md');
    }
  });

  it('refuses to overwrite an existing hermes.toml', async () => {
    await initCommand({ name: 'first', dir });
    await expect(initCommand({ name: 'second', dir })).rejects.toThrow(/already exists/);
  });

  it('does not overwrite an existing SOUL.md', async () => {
    writeFileSync(join(dir, 'SOUL.md'), '# pre-existing user content');
    await initCommand({ name: 'preserve', dir });
    expect(readFileSync(join(dir, 'SOUL.md'), 'utf-8')).toBe('# pre-existing user content');
  });

  it('does not overwrite an existing config.yaml', async () => {
    writeFileSync(join(dir, 'config.yaml'), 'model:\n  default: my-model\n');
    await initCommand({ name: 'preserve-config', dir });
    expect(readFileSync(join(dir, 'config.yaml'), 'utf-8')).toBe('model:\n  default: my-model\n');
  });
});
