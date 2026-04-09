import { execFileSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AgeKeypair {
  privateKeyPath: string;
  publicKey: string; // age1...
}

export function generateAgeKeypair(privateKeyPath: string): AgeKeypair {
  if (existsSync(privateKeyPath)) {
    throw new Error(`age key already exists at ${privateKeyPath}`);
  }
  mkdirSync(dirname(privateKeyPath), { recursive: true });

  let stdout: string;
  try {
    stdout = execFileSync('age-keygen', [], { encoding: 'utf-8' });
  } catch (e) {
    throw new Error(
      `age-keygen failed: ${(e as Error).message}. Install age (e.g. 'brew install age').`,
    );
  }

  // Format:
  // # created: 2026-04-09T...
  // # public key: age1...
  // AGE-SECRET-KEY-1...
  const pubMatch = stdout.match(/^# public key: (age1[a-z0-9]+)$/m);
  if (!pubMatch) {
    throw new Error(`age-keygen output did not contain a public key line: ${stdout}`);
  }
  const publicKey = pubMatch[1]!;

  writeFileSync(privateKeyPath, stdout);
  chmodSync(privateKeyPath, 0o600);

  return { privateKeyPath, publicKey };
}
