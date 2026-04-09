import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeConfigHash } from '../../../src/state/hash.js';

describe('computeConfigHash', () => {
  it('produces a stable sha256 hash for the same inputs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'hermes.toml'), 'name="x"');
    writeFileSync(join(dir, 'secrets.enc.yaml'), 'enc:1');
    const a = computeConfigHash([
      join(dir, 'hermes.toml'),
      join(dir, 'secrets.enc.yaml'),
    ]);
    const b = computeConfigHash([
      join(dir, 'hermes.toml'),
      join(dir, 'secrets.enc.yaml'),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    rmSync(dir, { recursive: true });
  });

  it('changes when any input file changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'a'), '1');
    const before = computeConfigHash([join(dir, 'a')]);
    writeFileSync(join(dir, 'a'), '2');
    const after = computeConfigHash([join(dir, 'a')]);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('skips missing optional files when allowMissing=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'a'), '1');
    const h = computeConfigHash([join(dir, 'a'), join(dir, 'missing')], true);
    expect(h).toMatch(/^sha256:/);
    rmSync(dir, { recursive: true });
  });
});
