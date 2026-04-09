import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function computeConfigHash(filePaths: string[], allowMissing = false): string {
  const hash = createHash('sha256');
  for (const path of filePaths) {
    if (!existsSync(path)) {
      if (allowMissing) continue;
      throw new Error(`computeConfigHash: file not found: ${path}`);
    }
    hash.update(`${path}\n`);
    hash.update(readFileSync(path));
    hash.update('\n--\n');
  }
  return `sha256:${hash.digest('hex')}`;
}
