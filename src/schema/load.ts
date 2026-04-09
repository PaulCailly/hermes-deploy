import { readFileSync, existsSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema, type HermesTomlConfig } from './hermes-toml.js';

export class HermesTomlError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'HermesTomlError';
  }
}

export function loadHermesToml(path: string): HermesTomlConfig {
  if (!existsSync(path)) {
    throw new HermesTomlError(`hermes.toml not found at ${path}`, path);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new HermesTomlError(`failed to read ${path}: ${(e as Error).message}`, path);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (e) {
    throw new HermesTomlError(`invalid TOML in ${path}: ${(e as Error).message}`, path);
  }

  const result = HermesTomlSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map(
      i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new HermesTomlError(
      `validation failed for ${path}:\n${lines.join('\n')}`,
      path,
    );
  }

  return result.data;
}
