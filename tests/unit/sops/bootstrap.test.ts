import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';

const sopsAvailable = (() => {
  try {
    execSync('which sops', { stdio: 'ignore' });
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sopsAvailable)('ensureSopsBootstrap (M3 dotenv)', () => {
  let dir: string;
  let publicKey: string;
  let ageKeyFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-sops-m3-'));
    // Generate a real age key so sops can encrypt and we can decrypt
    const ageOutput = execSync('age-keygen', { encoding: 'utf-8' });
    const m = ageOutput.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m || !m[1]) throw new Error('age-keygen output missing public key');
    publicKey = m[1];
    ageKeyFile = join(dir, 'age.key');
    writeFileSync(ageKeyFile, ageOutput);
    process.env['SOPS_AGE_KEY_FILE'] = ageKeyFile;
  });

  it('creates .sops.yaml with the age recipient and the dotenv path regex', () => {
    ensureSopsBootstrap(dir, publicKey);
    const sopsYaml = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(sopsYaml).toContain('age1');
    expect(sopsYaml).toContain('secrets\\.env\\.enc$');
    rmSync(dir, { recursive: true });
  });

  it('creates secrets.env.enc as a dotenv-format sops file', () => {
    ensureSopsBootstrap(dir, publicKey);
    expect(existsSync(join(dir, 'secrets.env.enc'))).toBe(true);
    // Decrypt with sops and verify the result is dotenv-format.
    // --input-type dotenv is required because sops uses the dotenv container
    // format (KEY=ENC[...] lines) which it cannot autodetect from .env.enc.
    const decrypted = execSync(
      `sops --decrypt --input-type dotenv --output-type dotenv ${join(dir, 'secrets.env.enc')}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, SOPS_AGE_KEY_FILE: ageKeyFile },
      },
    );
    // The placeholder line keeps the file non-empty so sops accepts it.
    // After M3 init, real users immediately overwrite this via secret set.
    expect(decrypted).toMatch(/^_HERMES_DEPLOY_PLACEHOLDER=/m);
    rmSync(dir, { recursive: true });
  });

  it('is idempotent: re-running does not overwrite existing files', () => {
    ensureSopsBootstrap(dir, publicKey);
    const sopsBefore = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    const secretsBefore = readFileSync(join(dir, 'secrets.env.enc'), 'utf-8');
    ensureSopsBootstrap(dir, publicKey);
    expect(readFileSync(join(dir, '.sops.yaml'), 'utf-8')).toBe(sopsBefore);
    expect(readFileSync(join(dir, 'secrets.env.enc'), 'utf-8')).toBe(secretsBefore);
    rmSync(dir, { recursive: true });
  });

  it('does not create a v1-shape secrets.enc.yaml file', () => {
    ensureSopsBootstrap(dir, publicKey);
    expect(existsSync(join(dir, 'secrets.enc.yaml'))).toBe(false);
    rmSync(dir, { recursive: true });
  });
});
