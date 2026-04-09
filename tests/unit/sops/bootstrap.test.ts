import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';

const sopsInstalled = (() => {
  try { execSync('which sops', { stdio: 'ignore' }); return true; } catch { return false; }
})();

describe.skipIf(!sopsInstalled)('ensureSopsBootstrap', () => {
  let dir: string;
  let realPublicKey: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-sops-'));
    // Generate a real age key so sops can encrypt successfully
    const ageOutput = execSync('age-keygen', { encoding: 'utf-8' });
    realPublicKey = ageOutput.match(/^# public key: (age1[a-z0-9]+)$/m)![1];
    // Save private key to a temp file and point sops at it
    const ageKeyFile = join(dir, 'age-key.txt');
    writeFileSync(ageKeyFile, ageOutput);
    process.env['SOPS_AGE_KEY_FILE'] = ageKeyFile;
  });

  it('creates .sops.yaml with the given age recipient', () => {
    ensureSopsBootstrap(dir, realPublicKey);
    const sopsYaml = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(sopsYaml).toContain('age1');
    expect(sopsYaml).toContain('secrets\\.enc\\.yaml$');
    rmSync(dir, { recursive: true });
  });

  it('creates an empty encrypted secrets.enc.yaml', () => {
    ensureSopsBootstrap(dir, realPublicKey);
    expect(existsSync(join(dir, 'secrets.enc.yaml'))).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('is idempotent: re-running does not change existing files', () => {
    ensureSopsBootstrap(dir, realPublicKey);
    const before = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    ensureSopsBootstrap(dir, realPublicKey);
    const after = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(after).toBe(before);
    rmSync(dir, { recursive: true });
  });
});
