import { copyFileSync, existsSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getStatePaths } from '../state/paths.js';

/**
 * Read the per-deployment age private key file. Used by `key export`
 * to print the contents to stdout for safe transport (encrypted USB,
 * password manager, etc.) to another machine.
 */
export async function keyExport(opts: { name: string }): Promise<string> {
  const paths = getStatePaths();
  const keyPath = paths.ageKeyForDeployment(opts.name);
  if (!existsSync(keyPath)) {
    throw new Error(`no age key for deployment "${opts.name}" at ${keyPath}`);
  }
  return readFileSync(keyPath, 'utf-8');
}

/**
 * Copy a previously-exported age key into the local hermes-deploy
 * config directory under the given deployment name. Refuses to
 * overwrite an existing key — call this on a fresh machine before
 * running `up`/`update` against a deployment that was created
 * elsewhere.
 */
export async function keyImport(opts: { name: string; path: string }): Promise<string> {
  const paths = getStatePaths();
  const destPath = paths.ageKeyForDeployment(opts.name);
  if (existsSync(destPath)) {
    throw new Error(
      `age key for "${opts.name}" already exists at ${destPath} — remove it first if you really want to overwrite`,
    );
  }
  if (!existsSync(opts.path)) {
    throw new Error(`source file does not exist: ${opts.path}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(opts.path, destPath);
  chmodSync(destPath, 0o600);
  return destPath;
}

/**
 * Print the on-disk path of a deployment's age key. Useful for piping
 * to other sops commands or just locating the file for backup.
 */
export async function keyPath(opts: { name: string }): Promise<string> {
  return getStatePaths().ageKeyForDeployment(opts.name);
}
