import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ImageRef } from '../core.js';

const NIXOS_OWNER_ID = '427812963091'; // NixOS Foundation
const NIXOS_NAME_PATTERN = 'nixos/24.05*-x86_64-linux';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedImage {
  region: string;
  imageId: string;
  description: string;
  fetchedAt: number;
}

interface ImageCache {
  entries: CachedImage[];
}

export async function resolveNixosAmi(
  ec2: EC2Client,
  region: string,
  cacheFile: string,
): Promise<ImageRef> {
  const now = Date.now();

  const cache = readCache(cacheFile);
  const hit = cache.entries.find(
    e => e.region === region && now - e.fetchedAt < CACHE_TTL_MS,
  );
  if (hit) {
    return { id: hit.imageId, description: hit.description };
  }

  const result = await ec2.send(
    new DescribeImagesCommand({
      Owners: [NIXOS_OWNER_ID],
      Filters: [
        { Name: 'name', Values: [NIXOS_NAME_PATTERN] },
        { Name: 'architecture', Values: ['x86_64'] },
        { Name: 'state', Values: ['available'] },
      ],
    }),
  );

  const images = result.Images ?? [];
  if (images.length === 0) {
    throw new Error(`no NixOS AMI found in region ${region} matching ${NIXOS_NAME_PATTERN}`);
  }

  const sorted = [...images].sort((a, b) => {
    const da = new Date(a.CreationDate ?? 0).getTime();
    const db = new Date(b.CreationDate ?? 0).getTime();
    return db - da;
  });
  const latest = sorted[0]!;

  const ref: ImageRef = {
    id: latest.ImageId!,
    description: latest.Name ?? 'nixos',
  };

  cache.entries = cache.entries.filter(e => e.region !== region);
  cache.entries.push({
    region,
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
