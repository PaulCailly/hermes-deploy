import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCliUpdate } from '../../../src/updates/cli-update-check.js';

describe('checkCliUpdate', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'hermes-update-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('fetches from npm and writes cache file', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.updateAvailable).toBe(true);
    expect(result.latest).toBe('2.0.0');
    expect(existsSync(cacheFile)).toBe(true);
  });

  it('reads from cache when within TTL', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    writeFileSync(cacheFile, JSON.stringify({ latest: '3.0.0', checkedAt: Date.now() }));
    const fetcher = vi.fn();
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.latest).toBe('3.0.0');
    expect(result.updateAvailable).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('re-fetches when cache is expired', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    writeFileSync(cacheFile, JSON.stringify({ latest: '1.0.0', checkedAt: Date.now() - 25 * 60 * 60 * 1000 }));
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.latest).toBe('2.0.0');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns up-to-date on fetch failure with no cache', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.updateAvailable).toBe(false);
  });
});
