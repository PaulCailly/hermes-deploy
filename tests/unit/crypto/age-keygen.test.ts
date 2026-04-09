import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { generateAgeKeypair } from '../../../src/crypto/age-keygen.js';

const ageInstalled = (() => {
  try {
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!ageInstalled)('generateAgeKeypair (requires age-keygen on PATH)', () => {
  it('writes a private key file and returns the public key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-age-'));
    const path = join(dir, 'age.key');
    const result = generateAgeKeypair(path);
    expect(existsSync(path)).toBe(true);
    expect(result.publicKey).toMatch(/^age1[a-z0-9]{58}$/);
    expect(readFileSync(path, 'utf-8')).toContain('AGE-SECRET-KEY-1');
    rmSync(dir, { recursive: true });
  });

  it('refuses to overwrite an existing key file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-age-'));
    const path = join(dir, 'age.key');
    generateAgeKeypair(path);
    expect(() => generateAgeKeypair(path)).toThrow(/already exists/);
    rmSync(dir, { recursive: true });
  });
});
