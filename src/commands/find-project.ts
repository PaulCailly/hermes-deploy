import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export function findUp(startDir: string, filename: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, filename))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
