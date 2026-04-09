import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SshKeypair {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string; // ssh-ed25519 AAAA... line
}

export function generateSshKeypair(privateKeyPath: string): SshKeypair {
  if (existsSync(privateKeyPath)) {
    throw new Error(`SSH private key already exists at ${privateKeyPath}`);
  }
  mkdirSync(dirname(privateKeyPath), { recursive: true });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  writeFileSync(privateKeyPath, privPem);
  chmodSync(privateKeyPath, 0o600);

  // Build OpenSSH-format public key
  const sshPub = toOpenSshPublic(publicKey.export({ format: 'der', type: 'spki' }) as Buffer);
  const publicKeyPath = `${privateKeyPath}.pub`;
  writeFileSync(publicKeyPath, sshPub);
  chmodSync(publicKeyPath, 0o644);

  return { privateKeyPath, publicKeyPath, publicKey: sshPub.trim() };
}

function toOpenSshPublic(spki: Buffer): string {
  // Extract the 32-byte ed25519 public key from SPKI DER
  // The last 32 bytes of an ed25519 SPKI are the raw public key
  const pubBytes = spki.subarray(spki.length - 32);
  // OpenSSH wire format: string "ssh-ed25519" + string <pubBytes>
  const algo = Buffer.from('ssh-ed25519');
  const buf = Buffer.concat([
    lenPrefix(algo),
    lenPrefix(pubBytes),
  ]);
  return `ssh-ed25519 ${buf.toString('base64')} hermes-deploy\n`;
}

function lenPrefix(b: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}
