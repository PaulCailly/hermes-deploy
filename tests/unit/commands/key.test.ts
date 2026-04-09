import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  chmodSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyExport, keyImport, keyPath } from '../../../src/commands/key.js';

describe('key subcommands', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-key-'));
    process.env.XDG_CONFIG_HOME = configDir;
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    const path = join(configDir, 'hermes-deploy/age_keys/alpha');
    writeFileSync(path, '# public key: age1abc\nAGE-SECRET-KEY-1abc\n');
    chmodSync(path, 0o600);
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('exports the age key content', async () => {
    const content = await keyExport({ name: 'alpha' });
    expect(content).toContain('AGE-SECRET-KEY-1abc');
  });

  it('throws on export of a missing key', async () => {
    await expect(keyExport({ name: 'missing' })).rejects.toThrow(/no age key/);
  });

  it('imports an age key to the right path with chmod 600', async () => {
    const src = join(configDir, 'external.key');
    writeFileSync(src, '# public key: age1xyz\nAGE-SECRET-KEY-1xyz\n');
    await keyImport({ name: 'imported', path: src });
    const dest = join(configDir, 'hermes-deploy/age_keys/imported');
    expect(existsSync(dest)).toBe(true);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    expect(readFileSync(dest, 'utf-8')).toContain('AGE-SECRET-KEY-1xyz');
  });

  it('refuses to overwrite an existing key on import', async () => {
    const src = join(configDir, 'external.key');
    writeFileSync(src, 'age key content');
    await expect(keyImport({ name: 'alpha', path: src })).rejects.toThrow(/already exists/);
  });

  it('throws on import from a missing source file', async () => {
    await expect(
      keyImport({ name: 'never', path: '/nonexistent/source.key' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('reports the on-disk path of a key', async () => {
    const p = await keyPath({ name: 'alpha' });
    expect(p).toBe(join(configDir, 'hermes-deploy/age_keys/alpha'));
  });
});
