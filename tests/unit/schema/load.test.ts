import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHermesToml, HermesTomlError } from '../../../src/schema/load.js';

describe('loadHermesToml', () => {
  it('loads and validates a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, `
name = "ok"
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
    const config = loadHermesToml(path);
    expect(config.name).toBe('ok');
    rmSync(dir, { recursive: true });
  });

  it('throws HermesTomlError on syntactically invalid TOML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, 'this is = = not toml');
    expect(() => loadHermesToml(path)).toThrow(HermesTomlError);
    rmSync(dir, { recursive: true });
  });

  it('throws HermesTomlError with field path on schema violation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, `
name = "x"
[cloud]
provider = "azure"
profile = "p"
region = "r"
size = "small"
[hermes]
model = "m"
soul = "s"
secrets_file = "se"
[hermes.platforms.discord]
enabled = true
`);
    try {
      loadHermesToml(path);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HermesTomlError);
      expect((e as HermesTomlError).message).toContain('cloud.provider');
    }
    rmSync(dir, { recursive: true });
  });

  it('throws clear error on missing file', () => {
    expect(() => loadHermesToml('/no/such/file.toml')).toThrow(HermesTomlError);
  });
});
