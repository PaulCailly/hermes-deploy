import { request } from 'node:https';

export interface NpmCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface NpmVersionPayload {
  version: string;
}

export type NpmFetcher = () => Promise<NpmVersionPayload>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cached: { result: NpmCheckResult; expiresAt: number } | null = null;

/** Visible for testing — resets the in-memory cache. */
export function _resetCache(): void {
  cached = null;
}

const defaultFetcher: NpmFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'registry.npmjs.org',
        path: '/@paulcailly%2fhermes-deploy/latest',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('invalid JSON from npm registry')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('npm registry timeout')); });
    req.end();
  });

export async function checkNpmUpdate(
  currentVersion: string,
  fetcher: NpmFetcher = defaultFetcher,
): Promise<NpmCheckResult> {
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  try {
    const data = await fetcher();
    const latest = data.version;
    const updateAvailable = compareSemver(latest, currentVersion) > 0;
    const result: NpmCheckResult = { current: currentVersion, latest, updateAvailable };
    cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
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
