import { request } from 'node:https';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
}

export interface LatestAgentRelease {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
}

export type ReleaseFetcher = () => Promise<GitHubRelease[]>;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cached: { result: LatestAgentRelease | null; expiresAt: number } | null = null;

export function _resetCache(): void { cached = null; }

const defaultFetcher: ReleaseFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'api.github.com',
        path: '/repos/NousResearch/hermes-agent/releases?per_page=5',
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-deploy' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('invalid JSON from GitHub API')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('GitHub API timeout')); });
    req.end();
  });

export async function checkHermesAgentRelease(
  fetcher: ReleaseFetcher = defaultFetcher,
): Promise<LatestAgentRelease | null> {
  if (cached && Date.now() < cached.expiresAt) return cached.result;
  try {
    const releases = await fetcher();
    if (!Array.isArray(releases) || releases.length === 0) {
      cached = { result: null, expiresAt: Date.now() + CACHE_TTL_MS };
      return null;
    }
    const latest = releases[0]!;
    const result: LatestAgentRelease = {
      tag: latest.tag_name,
      name: latest.name,
      publishedAt: latest.published_at,
      body: latest.body,
    };
    cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch {
    return null;
  }
}
