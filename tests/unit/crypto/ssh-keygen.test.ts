import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSshKeypair } from '../../../src/crypto/ssh-keygen.js';

describe('generateSshKeypair', () => {
  it('writes private and public key files with chmod 600 / 644', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-ssh-'));
    const priv = join(dir, 'id_ed25519');
    const result = generateSshKeypair(priv);
    expect(existsSync(priv)).toBe(true);
    expect(existsSync(`${priv}.pub`)).toBe(true);
    const privMode = statSync(priv).mode & 0o777;
    expect(privMode).toBe(0o600);
    const pubMode = statSync(`${priv}.pub`).mode & 0o777;
    expect(pubMode).toBe(0o644);
    expect(readFileSync(priv, 'utf-8')).toContain('PRIVATE KEY');
    expect(result.publicKey).toMatch(/^ssh-ed25519 /);
    rmSync(dir, { recursive: true });
  });

  it('throws if the private key file already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-ssh-'));
    const priv = join(dir, 'id_ed25519');
    generateSshKeypair(priv);
    expect(() => generateSshKeypair(priv)).toThrow(/already exists/);
    rmSync(dir, { recursive: true });
  });
});
