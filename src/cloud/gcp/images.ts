import { ImagesClient } from '@google-cloud/compute';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ImageRef } from '../core.js';

const NIXOS_PROJECT = 'nixos-foundation-org';
const NIXOS_NAME_PREFIX = 'nixos-25-11';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedImage {
  cloud: string;
  imageId: string;
  description: string;
  fetchedAt: number;
}

interface ImageCache {
  entries: CachedImage[];
}

export async function resolveNixosGceImage(
  cacheFile: string,
): Promise<ImageRef> {
  const now = Date.now();

  const cache = readCache(cacheFile);
  const hit = cache.entries.find(
    e => e.cloud === 'gcp' && now - e.fetchedAt < CACHE_TTL_MS,
  );
  if (hit) {
    return { id: hit.imageId, description: hit.description };
  }

  const client = new ImagesClient();
  const [images] = await client.list({
    project: NIXOS_PROJECT,
    filter: `name = "${NIXOS_NAME_PREFIX}*"`,
  });

  const matching = (images ?? []).filter(
    img => img.name?.startsWith(NIXOS_NAME_PREFIX),
  );
  if (matching.length === 0) {
    throw new Error(`no NixOS GCE image found matching ${NIXOS_NAME_PREFIX}*`);
  }

  const sorted = [...matching].sort((a, b) => {
    const da = new Date(a.creationTimestamp ?? 0).getTime();
    const db = new Date(b.creationTimestamp ?? 0).getTime();
    return db - da;
  });
  const latest = sorted[0]!;

  const ref: ImageRef = {
    id: latest.selfLink!,
    description: latest.name ?? 'nixos',
  };

  cache.entries = cache.entries.filter(e => e.cloud !== 'gcp');
  cache.entries.push({
    cloud: 'gcp',
    imageId: ref.id,
    description: ref.description,
    fetchedAt: now,
  });
  writeCache(cacheFile, cache);

  return ref;
}

function readCache(path: string): ImageCache {
  if (!existsSync(path)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ImageCache;
  } catch {
    return { entries: [] };
  }
}

function writeCache(path: string, cache: ImageCache): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}
