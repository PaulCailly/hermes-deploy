import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkHermesAgentRelease, _resetCache, type GitHubRelease } from '../../../src/updates/hermes-agent-check.js';

const fakeRelease: GitHubRelease = {
  tag_name: 'v2026.4.16',
  name: 'Hermes Agent v0.10.0 (2026.4.16)',
  published_at: '2026-04-16T19:53:25Z',
  body: '# Release notes\n\nSome changes.',
};

describe('checkHermesAgentRelease', () => {
  beforeEach(() => { _resetCache(); });

  it('returns the latest release', async () => {
    const fetcher = vi.fn().mockResolvedValue([fakeRelease]);
    const result = await checkHermesAgentRelease(fetcher);
    expect(result).not.toBeNull();
    expect(result!.tag).toBe('v2026.4.16');
    expect(result!.name).toBe('Hermes Agent v0.10.0 (2026.4.16)');
    expect(result!.publishedAt).toBe('2026-04-16T19:53:25Z');
    expect(result!.body).toContain('Release notes');
  });

  it('returns null when no releases exist', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    expect(await checkHermesAgentRelease(fetcher)).toBeNull();
  });

  it('caches results within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue([fakeRelease]);
    await checkHermesAgentRelease(fetcher);
    await checkHermesAgentRelease(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null on fetch error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    expect(await checkHermesAgentRelease(fetcher)).toBeNull();
  });
});
