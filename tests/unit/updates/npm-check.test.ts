import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNpmUpdate, _resetCache } from '../../../src/updates/npm-check.js';

describe('checkNpmUpdate', () => {
  beforeEach(() => { _resetCache(); });

  it('detects when an update is available', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result).toEqual({ current: '1.2.1', latest: '2.0.0', updateAvailable: true });
  });

  it('reports up-to-date when versions match', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '1.2.1' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
  });

  it('reports up-to-date when current is newer', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '1.2.0' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
  });

  it('caches results within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    await checkNpmUpdate('1.2.1', fetcher);
    await checkNpmUpdate('1.2.1', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns updateAvailable=false on fetch error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
    expect(result.latest).toBe('1.2.1');
  });
});
