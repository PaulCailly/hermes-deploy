import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';

let cachedVersion: string | null = null;

function readVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // Walk up from dist/server -> dist -> repo root to find package.json
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // Try a few candidate paths
    const candidates = [
      join(thisDir, '../../package.json'),
      join(thisDir, '../../../package.json'),
      join(thisDir, '../package.json'),
    ];
    for (const p of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name && pkg.version) {
          cachedVersion = `${pkg.name}@${pkg.version}`;
          return cachedVersion;
        }
      } catch {
        // continue
      }
    }
  } catch {
    // fall through
  }
  cachedVersion = 'unknown';
  return cachedVersion;
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/info', async () => ({
    version: readVersion(),
    buildTime: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  }));
}
