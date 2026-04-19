import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Computes a content-only sha256 of the given files, in order.
 * The hash is independent of file paths (so the same content at different
 * paths or on different machines produces the same hash). Order matters:
 * if you swap the order of inputs, the hash differs.
 *
 * @param filePaths Files to hash, in canonical order (e.g. always
 *   [hermes.toml, secrets.enc.yaml, configuration.nix.extra]).
 * @param allowMissing If true, missing files are skipped instead of throwing.
 */
export function computeConfigHash(filePaths: string[], allowMissing = false, extraData?: string): string {
  const hash = createHash('sha256');
  for (const path of filePaths) {
    if (!existsSync(path)) {
      if (allowMissing) continue;
      throw new Error(`computeConfigHash: file not found: ${path}`);
    }
    hash.update(readFileSync(path));
    hash.update('\n--\n');
  }
  if (extraData) {
    hash.update(extraData);
    hash.update('\n--\n');
  }
  return `sha256:${hash.digest('hex')}`;
}
