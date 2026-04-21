import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NpmFetcher, NpmCheckResult } from './npm-check.js';

interface CacheEntry {
  latest: string;
  checkedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function checkCliUpdate(
  currentVersion: string,
  cacheFile: string,
  fetcher?: NpmFetcher,
): Promise<NpmCheckResult> {
  // Try reading cache
  try {
    const raw = readFileSync(cacheFile, 'utf-8');
    const cache: CacheEntry = JSON.parse(raw);
    if (Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      const updateAvailable = compareSemver(cache.latest, currentVersion) > 0;
      return { current: currentVersion, latest: cache.latest, updateAvailable };
    }
  } catch {
    // No cache or invalid — fetch fresh
  }

  // Fetch from npm
  if (!fetcher) {
    const { checkNpmUpdate } = await import('./npm-check.js');
    return checkNpmUpdate(currentVersion);
  }

  try {
    const data = await fetcher();
    const latest = data.version;
    const entry: CacheEntry = { latest, checkedAt: Date.now() };
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(entry));
    } catch {
      // Cache write failure is non-fatal
    }
    const updateAvailable = compareSemver(latest, currentVersion) > 0;
    return { current: currentVersion, latest, updateAvailable };
  } catch {
    return { current: currentVersion, latest: currentVersion, updateAvailable: false };
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
