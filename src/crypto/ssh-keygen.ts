import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SshKeypair {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string; // ssh-ed25519 AAAA... line
}

// We shell out to `ssh-keygen` rather than using node:crypto because the
// ssh2 client library we use for remote ops cannot parse PKCS#8-format
// ed25519 keys (which is what crypto.generateKeyPair exports). ssh-keygen
// produces the newer OPENSSH format that ssh2 understands. ssh-keygen is
// already a README prerequisite.
export function generateSshKeypair(privateKeyPath: string): SshKeypair {
  if (existsSync(privateKeyPath)) {
    throw new Error(`SSH private key already exists at ${privateKeyPath}`);
  }
  mkdirSync(dirname(privateKeyPath), { recursive: true });

  execFileSync(
    'ssh-keygen',
    [
      '-t', 'ed25519',
      '-f', privateKeyPath,
      '-N', '',
      '-C', 'hermes-deploy',
      '-q',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  chmodSync(privateKeyPath, 0o600);
  const publicKeyPath = `${privateKeyPath}.pub`;
  chmodSync(publicKeyPath, 0o644);
  const publicKey = readFileSync(publicKeyPath, 'utf-8').trim();

  return { privateKeyPath, publicKeyPath, publicKey };
}
